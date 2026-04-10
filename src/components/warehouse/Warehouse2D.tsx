import { useRef, useEffect, useState, useCallback } from "react";
import type { WarehouseParams } from "./WarehouseConfig";
import type { MovementOrder, SlotAddress } from "./MovementCommand";
import { rowToAisleSide } from "./MovementCommand";
import type { ComponentStyles, ComponentType } from "./ComponentStyles";
import type { AMROrder } from "./AMRCommand";
import type { AGVInfo } from "@/hooks/useAGVs";

interface Warehouse2DProps {
  params: WarehouseParams;
  movementOrders: MovementOrder[];
  movementOrdersKey?: number;
  onAnimationComplete: () => void;
  componentStyles: ComponentStyles;
  onComponentClick: (type: ComponentType) => void;
  moveRobotMode?: boolean;
  amrOrders: AMROrder[];
  amrOrdersKey?: number;
  onAMRComplete: () => void;
  agvs: AGVInfo[];
}

const PACKING_STATIONS_COUNT = 3;
const PACKING_SLOTS_PER_STATION = 9;

const SLOT_W_M = 0.4;
const SLOT_D_M = 0.6;
const AISLE_W_M = 0.5;
const GAP_BETWEEN_PAIRS = 1.2;
const AMR_PATH_WIDTH_M = 0.5;
const PATH_MARGIN_M = 0.6; // gap between warehouse and AMR path
const LANE_GAP_M = 0.4; // distance between the two lane center lines (doubled for collision avoidance)
const LANE_LINE_W_PX = 2; // pixel width of each lane line
const PARKING_SPOT_W_M = 0.8; // width of each parking spot
const PARKING_SPOT_H_M = 0.6; // height of each parking spot
const PARKING_GAP_M = 0.6; // gap between parking spots
const PARKING_MARGIN_M = 0.8; // gap between right AMR path and parking area

function aisleYOffset(a: number, numAisles: number, aisleGroupH: number): number {
  const pairIdx = Math.floor(a / 2);
  const withinPair = a % 2;
  return pairIdx * (2 * aisleGroupH + GAP_BETWEEN_PAIRS) + withinPair * aisleGroupH;
}

function totalAisleSpan(numAisles: number, aisleGroupH: number): number {
  if (numAisles <= 0) return 0;
  const lastOffset = aisleYOffset(numAisles - 1, numAisles, aisleGroupH);
  return lastOffset + aisleGroupH;
}

type AnimPhase =
  | "idle"
  | "move_to_source"
  | "extend_to_source"
  | "retract_from_source"
  | "move_to_dest"
  | "extend_to_dest"
  | "retract_from_dest"
  | "done";

interface AnimState {
  phase: AnimPhase;
  shuttleRackPos: number;
  forkExtend: number;
  sourceRack: number;
  sourceDeepOffset: number;
  destRack: number;
  destDeepOffset: number;
  sourceAisle: number;
  destAisle: number;
  hasTray: boolean;
  traySourceKey: string;
  activeShuttleIdx: number;
  orderQueue: MovementOrder[];
}

function getDeepOffset(addr: SlotAddress): number {
  const { side } = rowToAisleSide(addr.row);
  if (side === "top") {
    // deep=1 closest to aisle → fork extends -1 (1 slot up)
    return -addr.deep;
  } else {
    return addr.deep;
  }
}

interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  type: ComponentType;
}

export function Warehouse2D({
  params,
  movementOrders,
  movementOrdersKey,
  onAnimationComplete,
  componentStyles,
  onComponentClick,
  moveRobotMode,
  amrOrders,
  amrOrdersKey,
  onAMRComplete,
  agvs,
}: Warehouse2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1, rotation: 0 });
  const [coordTooltip, setCoordTooltip] = useState<{ x: number; y: number; mx: number; my: number } | null>(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const clickStart = useRef({ x: 0, y: 0 });
  // Map of aisle index → AnimState for simultaneous shuttle animations
  const shuttleAnimMapRef = useRef<Map<number, AnimState>>(new Map());
  const [removedTrays, setRemovedTrays] = useState<Set<string>>(new Set());
  const [placedTrays, setPlacedTrays] = useState<{ aisle: number; rack: number; deepOffset: number }[]>([]);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const hitRegionsRef = useRef<HitRegion[]>([]);
  const gridInfoRef = useRef<{ ppm: number; siteX: number; siteY: number }>({ ppm: 1, siteX: 0, siteY: 0 });

  // AMR animation state — one per AGV for concurrent movement
  type AMRPhase = "idle" | "to_source" | "pickup" | "to_station" | "dropoff" | "return_to_idle" | "done";
  interface AMRAnimState {
    phase: AMRPhase;
    mx: number;
    my: number;
    waypoints: { mx: number; my: number }[];
    waypointIdx: number;
    hasTray: boolean;
    visible: boolean;
    pickupTimer: number;
    dropoffTimer: number;
    initialized: boolean;
    sourceWaypoints: { mx: number; my: number }[];
    stationWaypoints: { mx: number; my: number }[];
    returnWaypoints: { mx: number; my: number }[];
    sourceWpIdx: number;
    stationWpIdx: number;
    returnWpIdx: number;
    order: AMROrder | null;
    orderQueue: AMROrder[];
    angle: number; // heading angle in radians
    stopped: boolean; // collision stop
    stoppedTimer: number; // seconds stopped
    targetPackingStationIdx: number;
    targetPackingSlotIdx: number;
  }
  const createDefaultAMRState = (): AMRAnimState => ({
    phase: "idle",
    mx: 0,
    my: 0,
    waypoints: [],
    waypointIdx: 0,
    hasTray: false,
    visible: true,
    pickupTimer: 0,
    dropoffTimer: 0,
    initialized: false,
    sourceWaypoints: [],
    stationWaypoints: [],
    returnWaypoints: [],
    sourceWpIdx: 0,
    stationWpIdx: 0,
    returnWpIdx: 0,
    order: null,
    orderQueue: [],
    angle: 0,
    stopped: false,
    stoppedTimer: 0,
    targetPackingStationIdx: -1,
    targetPackingSlotIdx: -1,
  });
  const amrAnimMapRef = useRef<Map<number, AMRAnimState>>(new Map());
  const amrRafRef = useRef<number>(0);
  const drawCanvasRef = useRef<() => void>(() => {});
  const [filledPackingSlots, setFilledPackingSlots] = useState<Set<string>>(new Set());
  const filledPackingSlotsRef = useRef<Set<string>>(new Set());
  const reservedPackingSlotsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    filledPackingSlotsRef.current = filledPackingSlots;
  }, [filledPackingSlots]);

  const { rows, racks, deep } = params;
  const numAisles = Math.max(1, Math.floor(rows / 2));
  const rackGap = 0.05;
  const contentW = racks * SLOT_W_M + (racks - 1) * rackGap;
  const aisleGroupH = deep * SLOT_D_M + AISLE_W_M + deep * SLOT_D_M;
  const contentH = totalAisleSpan(numAisles, aisleGroupH);

  // Two idle positions per aisle: shuttle 0 at 1/4, shuttle 1 at 3/4
  const shuttleIdlePos = useCallback(
    (idx: number) => {
      return idx === 0 ? Math.floor((racks - 1) * 0.25) : Math.floor((racks - 1) * 0.75);
    },
    [racks],
  );

  // Helper to create AnimState for a single MovementOrder
  const createShuttleAnim = useCallback(
    (order: MovementOrder): AnimState => {
      const src = order.source;
      const dst = order.destination;
      const srcRack = src.rack - 1;
      const idle0 = shuttleIdlePos(0);
      const idle1 = shuttleIdlePos(1);
      const dist0 = Math.abs(srcRack - idle0);
      const dist1 = Math.abs(srcRack - idle1);
      const activeIdx = dist0 <= dist1 ? 0 : 1;
      const startPos = activeIdx === 0 ? idle0 : idle1;
      return {
        phase: "move_to_source",
        shuttleRackPos: startPos,
        forkExtend: 0,
        sourceRack: srcRack,
        sourceDeepOffset: getDeepOffset(src),
        destRack: dst.rack - 1,
        destDeepOffset: getDeepOffset(dst),
        sourceAisle: rowToAisleSide(src.row).aisleIdx,
        destAisle: rowToAisleSide(dst.row).aisleIdx,
        hasTray: false,
        traySourceKey: `${rowToAisleSide(src.row).aisleIdx}-${src.rack - 1}-${getDeepOffset(src)}`,
        activeShuttleIdx: activeIdx,
        orderQueue: [],
      };
    },
    [shuttleIdlePos],
  );

  // When movementOrders changes, group by aisle and populate map
  useEffect(() => {
    if (movementOrders.length === 0) {
      shuttleAnimMapRef.current.clear();
      setRemovedTrays(new Set());
      setPlacedTrays([]);
      return;
    }

    // Group orders by source aisle
    const byAisle = new Map<number, MovementOrder[]>();
    for (const order of movementOrders) {
      const aisleIdx = rowToAisleSide(order.source.row).aisleIdx;
      const list = byAisle.get(aisleIdx) ?? [];
      list.push(order);
      byAisle.set(aisleIdx, list);
    }

    shuttleAnimMapRef.current.clear();
    byAisle.forEach((orders, aisleIdx) => {
      const st = createShuttleAnim(orders[0]);
      st.orderQueue = orders.slice(1);
      shuttleAnimMapRef.current.set(aisleIdx, st);
    });

    lastTimeRef.current = performance.now();
    startShuttleLoop();
  }, [movementOrders, movementOrdersKey]);

  const [warehouseOffset, setWarehouseOffset] = useState({ x: 0, y: 0 });

  const SPEED = 0.6;
  const FORK_SPEED = 0.4;

  const shuttleLoopRunning = useRef(false);

  const startShuttleLoop = useCallback(() => {
    if (shuttleLoopRunning.current) return;
    shuttleLoopRunning.current = true;
    lastTimeRef.current = performance.now();

    const loop = () => {
      const now = performance.now();
      const delta = Math.min((now - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = now;

      let anyActive = false;
      shuttleAnimMapRef.current.forEach((st) => {
        if (st.phase === "idle" || st.phase === "done") return;
        anyActive = true;

        switch (st.phase) {
          case "move_to_source": {
            const diff = st.sourceRack - st.shuttleRackPos;
            if (Math.abs(diff) < 0.02) {
              st.shuttleRackPos = st.sourceRack;
              st.phase = "extend_to_source";
            } else {
              st.shuttleRackPos += Math.sign(diff) * SPEED * delta;
            }
            break;
          }
          case "extend_to_source": {
            const diff = st.sourceDeepOffset - st.forkExtend;
            if (Math.abs(diff) < 0.02) {
              st.forkExtend = st.sourceDeepOffset;
              st.hasTray = true;
              setRemovedTrays((prev) => new Set(prev).add(st.traySourceKey));
              st.phase = "retract_from_source";
            } else {
              st.forkExtend += Math.sign(diff) * FORK_SPEED * delta;
            }
            break;
          }
          case "retract_from_source": {
            const diff = 0 - st.forkExtend;
            if (Math.abs(diff) < 0.02) {
              st.forkExtend = 0;
              st.phase = "move_to_dest";
            } else {
              st.forkExtend += Math.sign(diff) * FORK_SPEED * delta;
            }
            break;
          }
          case "move_to_dest": {
            const diff = st.destRack - st.shuttleRackPos;
            if (Math.abs(diff) < 0.02) {
              st.shuttleRackPos = st.destRack;
              st.phase = "extend_to_dest";
            } else {
              st.shuttleRackPos += Math.sign(diff) * SPEED * delta;
            }
            break;
          }
          case "extend_to_dest": {
            const diff = st.destDeepOffset - st.forkExtend;
            if (Math.abs(diff) < 0.02) {
              st.forkExtend = st.destDeepOffset;
              st.hasTray = false;
              setPlacedTrays((prev) => [
                ...prev,
                {
                  aisle: st.destAisle,
                  rack: st.destRack,
                  deepOffset: st.destDeepOffset,
                },
              ]);
              st.phase = "retract_from_dest";
            } else {
              st.forkExtend += Math.sign(diff) * FORK_SPEED * delta;
            }
            break;
          }
          case "retract_from_dest": {
            const diff = 0 - st.forkExtend;
            if (Math.abs(diff) < 0.02) {
              st.forkExtend = 0;
              // Check queue for more orders
              if (st.orderQueue.length > 0) {
                const next = st.orderQueue.shift()!;
                const src = next.source;
                const dst = next.destination;
                st.sourceRack = src.rack - 1;
                st.sourceDeepOffset = getDeepOffset(src);
                st.destRack = dst.rack - 1;
                st.destDeepOffset = getDeepOffset(dst);
                st.sourceAisle = rowToAisleSide(src.row).aisleIdx;
                st.destAisle = rowToAisleSide(dst.row).aisleIdx;
                st.traySourceKey = `${st.sourceAisle}-${st.sourceRack}-${st.sourceDeepOffset}`;
                st.phase = "move_to_source";
              } else {
                st.phase = "done";
              }
            } else {
              st.forkExtend += Math.sign(diff) * FORK_SPEED * delta;
            }
            break;
          }
        }
      });

      drawCanvasRef.current();

      if (anyActive) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        shuttleLoopRunning.current = false;
        onAnimationComplete();
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [onAnimationComplete, createShuttleAnim]);

  // AMR animation: add new orders to the map when amrOrders changes
  useEffect(() => {
    if (amrOrders.length === 0) {
      reservedPackingSlotsRef.current.clear();
      return;
    }

    // Group orders by agvId — first order starts immediately, rest queue
    const ordersByAgv = new Map<number, AMROrder[]>();
    for (const order of amrOrders) {
      const list = ordersByAgv.get(order.agvId) ?? [];
      list.push(order);
      ordersByAgv.set(order.agvId, list);
    }

    ordersByAgv.forEach((agvOrderList, agvId) => {
      const existing = amrAnimMapRef.current.get(agvId);
      const st = createDefaultAMRState();
      st.phase = "to_source";
      st.initialized = existing?.initialized ?? false;
      st.mx = existing?.initialized ? existing.mx : 0;
      st.my = existing?.initialized ? existing.my : 0;
      st.order = agvOrderList[0];
      st.orderQueue = agvOrderList.slice(1); // remaining orders queued
      amrAnimMapRef.current.set(agvId, st);
    });

    startAMRLoop();
  }, [amrOrders, amrOrdersKey]);

  // Single animation loop drives ALL active AGVs
  const amrLastTimeRef = useRef<number>(0);
  const amrLoopRunning = useRef(false);

  const startAMRLoop = useCallback(() => {
    if (amrLoopRunning.current) return;
    amrLoopRunning.current = true;
    amrLastTimeRef.current = performance.now();

    const loop = () => {
      const now = performance.now();
      const delta = Math.min((now - amrLastTimeRef.current) / 1000, 0.05);
      amrLastTimeRef.current = now;

      const AMR_SPEED = 0.5;
      const PICKUP_DURATION = 0.8;
      const DROPOFF_DURATION = 0.8;

      const MIN_GAP = 0.4;
      const STOP_DIST = MIN_GAP + 0.15;
      const LANE_SWITCH_WAIT = 0.5;
      const BRANCH_YIELD_WAIT = 0.3;

      // Collect positions for collision checking
      const positions: { id: number; mx: number; my: number; stopped: boolean; active: boolean }[] = [];
      amrAnimMapRef.current.forEach((st, id) => {
        const active = st.phase !== "idle" && st.phase !== "done";
        positions.push({ id, mx: st.mx, my: st.my, stopped: st.stopped, active });
      });

      // Check if AGV should stop
      const checkBlocked = (
        agvId: number,
        mx: number,
        my: number,
        targetMX: number,
        targetMY: number,
        phase: AMRPhase,
      ): { blocked: boolean; shouldSwitch: boolean; shouldYield: boolean; blockerId: number } => {
        const dx = targetMX - mx;
        const dy = targetMY - my;
        const moveDist = Math.sqrt(dx * dx + dy * dy);
        if (moveDist < 0.001) return { blocked: false, shouldSwitch: false, shouldYield: false, blockerId: -1 };

        const ndx = dx / moveDist;
        const ndy = dy / moveDist;
        const laneThreshold = LANE_GAP_M * 0.6;

        let blocked = false;
        let shouldSwitch = false;
        let shouldYield = false;
        let blockerId = -1;

        for (const other of positions) {
          if (other.id === agvId) continue;
          const odx = other.mx - mx;
          const ody = other.my - my;
          const eucDist = Math.sqrt(odx * odx + ody * ody);
          const fwdDist = odx * ndx + ody * ndy;
          const perpDist = Math.abs(odx * -ndy + ody * ndx);

          // Same lane, ahead, too close
          if (perpDist < laneThreshold && fwdDist > 0 && eucDist < STOP_DIST) {
            blocked = true;
            blockerId = other.id;

            // Check if this is a head-on collision (other AGV moving toward us)
            const otherSt = amrAnimMapRef.current.get(other.id);
            if (otherSt) {
              const otherPhase = otherSt.phase;

              // Check if they're moving toward each other (head-on)
              let otherTarget: { mx: number; my: number } | null = null;
              if (otherPhase === "to_source" && otherSt.sourceWaypoints[otherSt.sourceWpIdx]) {
                otherTarget = otherSt.sourceWaypoints[otherSt.sourceWpIdx];
              } else if (otherPhase === "to_station" && otherSt.stationWaypoints[otherSt.stationWpIdx]) {
                otherTarget = otherSt.stationWaypoints[otherSt.stationWpIdx];
              } else if (otherPhase === "return_to_idle" && otherSt.returnWaypoints[otherSt.returnWpIdx]) {
                otherTarget = otherSt.returnWaypoints[otherSt.returnWpIdx];
              }

              if (otherTarget) {
                const otherDx = otherTarget.mx - other.mx;
                const otherDy = otherTarget.my - other.my;
                const otherMoveDist = Math.sqrt(otherDx * otherDx + otherDy * otherDy);
                if (otherMoveDist > 0.001) {
                  const otherNdx = otherDx / otherMoveDist;
                  const otherNdy = otherDy / otherMoveDist;
                  // Dot product of directions: negative means head-on
                  const dotProduct = ndx * otherNdx + ndy * otherNdy;
                  if (dotProduct < -0.5) {
                    // Head-on collision — higher ID yields (backs up)
                    if (agvId > other.id) {
                      shouldYield = true;
                    }
                    continue; // Don't also set shouldSwitch
                  }
                }
              }
            }

            // Same direction: higher ID does lane switch
            if (agvId > other.id) shouldSwitch = true;
          }

          // Very close ahead on any lane
          if (eucDist < MIN_GAP && eucDist > 0.001 && fwdDist > 0) {
            blocked = true;
            if (blockerId === -1) blockerId = other.id;
          }
        }
        return { blocked, shouldSwitch, shouldYield, blockerId };
      };

      const isLanePointFree = (agvId: number, mx: number, my: number): boolean => {
        for (const other of positions) {
          if (other.id === agvId) continue;
          const d = Math.sqrt((other.mx - mx) ** 2 + (other.my - my) ** 2);
          if (d < STOP_DIST) return false;
        }
        return true;
      };

      // Move AGV along waypoints with collision avoidance, lane switching, and yielding
      const moveAlongWaypoints = (
        st: AMRAnimState,
        agvId: number,
        waypoints: { mx: number; my: number }[],
        wpIdx: number,
        dt: number,
      ): { arrived: boolean; newIdx: number } => {
        const target = waypoints[wpIdx];
        if (!target) return { arrived: true, newIdx: wpIdx };

        const dx = target.mx - st.mx;
        const dy = target.my - st.my;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Smooth heading angle rotation
        if (dist > 0.001) {
          const targetAngle = Math.atan2(dy, dx);
          let angleDiff = targetAngle - st.angle;
          while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
          while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
          st.angle += angleDiff * Math.min(1, dt * 8);
        }

        const { blocked, shouldSwitch, shouldYield, blockerId } = checkBlocked(
          agvId,
          st.mx,
          st.my,
          target.mx,
          target.my,
          st.phase,
        );

        if (blocked) {
          st.stopped = true;
          st.stoppedTimer += dt;

          // HEAD-ON YIELD: back up by reversing waypoints to previous waypoint
          if (shouldYield && st.stoppedTimer > BRANCH_YIELD_WAIT) {
            // Insert a waypoint to back up to the previous waypoint position
            const prevWp = wpIdx > 0 ? waypoints[wpIdx - 1] : null;
            if (prevWp) {
              // Back up to previous waypoint, then re-approach after blocker passes
              const backupWps = [{ mx: prevWp.mx, my: prevWp.my }];
              // Insert backup waypoints before current target
              waypoints.splice(wpIdx, 0, ...backupWps);
              st.stopped = false;
              st.stoppedTimer = 0;
            }
            return { arrived: false, newIdx: wpIdx };
          }

          // LANE SWITCH: higher-ID AGV creates a detour on adjacent lane
          if (shouldSwitch && !shouldYield && st.stoppedTimer > LANE_SWITCH_WAIT) {
            const isHoriz = Math.abs(dx) > Math.abs(dy);
            const laneGap = LANE_GAP_M;

            for (const sign of [1, -1]) {
              const adjMX = st.mx + (isHoriz ? 0 : sign * laneGap);
              const adjMY = st.my + (isHoriz ? sign * laneGap : 0);

              const passDist = STOP_DIST * 4;
              const fwdX = isHoriz ? Math.sign(dx) * passDist : 0;
              const fwdY = isHoriz ? 0 : Math.sign(dy) * passDist;

              if (isLanePointFree(agvId, adjMX, adjMY) && isLanePointFree(agvId, adjMX + fwdX, adjMY + fwdY)) {
                // Right-angle detour: perpendicular → forward past blocker → perpendicular back
                const detour = [
                  { mx: adjMX, my: adjMY },
                  { mx: adjMX + fwdX, my: adjMY + fwdY },
                  { mx: st.mx + fwdX, my: st.my + fwdY },
                ];
                waypoints.splice(wpIdx, 0, ...detour);

                st.stopped = false;
                st.stoppedTimer = 0;
                break;
              }
            }
            return { arrived: false, newIdx: wpIdx };
          }

          return { arrived: false, newIdx: wpIdx };
        }

        // Not blocked — clear stop state and move
        st.stopped = false;
        st.stoppedTimer = 0;

        if (dist < 0.01) {
          st.mx = target.mx;
          st.my = target.my;
          return { arrived: false, newIdx: wpIdx + 1 };
        }

        const step = AMR_SPEED * dt;
        st.mx += (dx / dist) * Math.min(step, dist);
        st.my += (dy / dist) * Math.min(step, dist);
        return { arrived: false, newIdx: wpIdx };
      };

      let anyActive = false;
      amrAnimMapRef.current.forEach((st, agvId) => {
        if (st.phase === "idle" || st.phase === "done") return;
        anyActive = true;

        if (st.phase === "to_source" && st.sourceWaypoints.length === 0) return;

        if (st.phase === "to_source") {
          const { arrived, newIdx } = moveAlongWaypoints(st, agvId, st.sourceWaypoints, st.sourceWpIdx, delta);
          st.sourceWpIdx = newIdx;
          if (arrived) {
            st.phase = "pickup";
            st.pickupTimer = 0;
          }
        } else if (st.phase === "pickup") {
          st.pickupTimer += delta;
          if (st.pickupTimer >= PICKUP_DURATION) {
            st.hasTray = true;
            st.phase = "to_station";
          }
        } else if (st.phase === "to_station") {
          if (st.stationWaypoints.length === 0) return;
          const { arrived, newIdx } = moveAlongWaypoints(st, agvId, st.stationWaypoints, st.stationWpIdx, delta);
          st.stationWpIdx = newIdx;
          if (arrived) {
            st.phase = "dropoff";
            st.dropoffTimer = 0;
          }
        } else if (st.phase === "dropoff") {
          st.dropoffTimer += delta;
          if (st.dropoffTimer >= DROPOFF_DURATION) {
            st.hasTray = false;
            if (
              st.order?.flowType === "rack-to-station" &&
              st.targetPackingStationIdx >= 0 &&
              st.targetPackingSlotIdx >= 0
            ) {
              const key = `${st.targetPackingStationIdx}-${st.targetPackingSlotIdx}`;
              setFilledPackingSlots((prev) => {
                const next = new Set(prev);
                next.add(key);
                return next;
              });
              reservedPackingSlotsRef.current.delete(key);
            }
            st.phase = st.returnWaypoints.length > 0 ? "return_to_idle" : "done";
            st.returnWpIdx = 1;
            if (st.phase === "done") {
              if (st.orderQueue.length > 0) {
                const nextOrder = st.orderQueue.shift()!;
                st.order = nextOrder;
                st.phase = "to_source";
                st.sourceWaypoints = [];
                st.stationWaypoints = [];
                st.returnWaypoints = [];
                st.sourceWpIdx = 0;
                st.stationWpIdx = 0;
                st.returnWpIdx = 0;
                st.pickupTimer = 0;
                st.dropoffTimer = 0;
                st.targetPackingStationIdx = -1;
                st.targetPackingSlotIdx = -1;
              } else {
                onAMRComplete();
              }
            }
          }
        } else if (st.phase === "return_to_idle") {
          const { arrived, newIdx } = moveAlongWaypoints(st, agvId, st.returnWaypoints, st.returnWpIdx, delta);
          st.returnWpIdx = newIdx;
          if (arrived) {
            if (st.orderQueue.length > 0) {
              const nextOrder = st.orderQueue.shift()!;
              st.order = nextOrder;
              st.phase = "to_source";
              st.sourceWaypoints = [];
              st.stationWaypoints = [];
              st.returnWaypoints = [];
              st.sourceWpIdx = 0;
              st.stationWpIdx = 0;
              st.returnWpIdx = 0;
              st.pickupTimer = 0;
              st.dropoffTimer = 0;
              st.targetPackingStationIdx = -1;
              st.targetPackingSlotIdx = -1;
            } else {
              st.phase = "done";
              onAMRComplete();
            }
          }
        }
      });

      drawCanvasRef.current();

      if (anyActive) {
        amrRafRef.current = requestAnimationFrame(loop);
      } else {
        amrLoopRunning.current = false;
      }
    };
    amrRafRef.current = requestAnimationFrame(loop);
  }, [onAMRComplete]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = rect.width;
    const H = rect.height;

    ctx.fillStyle = "hsl(225, 15%, 12%)";
    ctx.fillRect(0, 0, W, H);

    if (rows <= 0 || racks <= 0 || deep <= 0) return;

    const hitRegions: HitRegion[] = [];

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);
    ctx.rotate(transform.rotation);

    const rot = transform.rotation;
    // Normalize angle to [0, 2π)
    const normRot = ((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    // If the canvas is rotated so text would be upside-down, flip 180°
    const textFlip = (normRot > Math.PI / 2 && normRot < 3 * Math.PI / 2) ? Math.PI : 0;

    // Helper: draw text that flips 180° when warehouse is upside-down
    const drawReadableText = (text: string, x: number, y: number, extraRotation = 0) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(textFlip + extraRotation);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };

    const padding = 60;

    // Stations config - vertical column parallel to AMR path
    const stations = PACKING_STATIONS_COUNT;
    const slotsPerStation = params.slotsPerStation ?? 9;
    const packingSlotsPerStation = PACKING_SLOTS_PER_STATION;
    const deliverySlots = 9;
    const stationSlotW_m = SLOT_W_M * 0.9;
    const stationSlotH_m = SLOT_D_M * 0.78;
    const stationW_m = stationSlotW_m + 0.24;
    const stationH_m = packingSlotsPerStation * stationSlotH_m + 0.12;
    const stationGap_m = 0.28;
    const amrPathW_m = AMR_PATH_WIDTH_M;
    const pathMargin_m = PATH_MARGIN_M;
    const leftExtra = stationW_m + amrPathW_m + pathMargin_m * 2 + 0.5;

    // Delivery station at the top (single)
    const deliverySlotW_m = SLOT_W_M;
    const deliverySlotH_m = SLOT_D_M;
    const deliveryW_m = deliverySlots * deliverySlotW_m + 0.26;
    const deliveryH_m = deliverySlotH_m + 0.26;
    const topExtra = deliveryH_m + amrPathW_m + pathMargin_m * 2 + 0.8;

    // Right side parking area extra space
    const agvList = agvs.length > 0 ? agvs : [{ agv_id: 1, agv_name: "agv1" }];
    const agvCount = agvList.length;
    const rightExtra = PARKING_MARGIN_M + PARKING_SPOT_W_M + 1.5;

    const scaleX = (W - padding * 2) / Math.max(params.length, contentW + leftExtra + rightExtra + 2);
    const scaleY = (H - padding * 2) / Math.max(params.width, contentH + topExtra + 2);
    const ppm = Math.min(scaleX, scaleY);

    const cosR = Math.cos(transform.rotation);
    const sinR = Math.sin(transform.rotation);
    const centerUx = (W / 2 - transform.x) / transform.scale;
    const centerUy = (H / 2 - transform.y) / transform.scale;
    const originX = centerUx * cosR + centerUy * sinR;
    const originY = -centerUx * sinR + centerUy * cosR;

    const siteW = params.length * ppm;
    const siteH = params.width * ppm;
    const siteX = originX - siteW / 2;
    const siteY = originY - siteH / 2;

    // ====== Grid Lines covering entire visible canvas (0.5m spacing) ======
    const gridSpacingM = 0.5;
    const gridSpacingPx = gridSpacingM * ppm;

    // Compute visible world bounds
    const toWorld = (sx: number, sy: number) => {
      const ux = (sx - transform.x) / transform.scale;
      const uy = (sy - transform.y) / transform.scale;
      return {
        x: ux * cosR + uy * sinR,
        y: -ux * sinR + uy * cosR,
      };
    };
    const p0 = toWorld(0, 0);
    const p1 = toWorld(W, 0);
    const p2 = toWorld(0, H);
    const p3 = toWorld(W, H);
    const visLeft = Math.min(p0.x, p1.x, p2.x, p3.x);
    const visTop = Math.min(p0.y, p1.y, p2.y, p3.y);
    const visRight = Math.max(p0.x, p1.x, p2.x, p3.x);
    const visBottom = Math.max(p0.y, p1.y, p2.y, p3.y);

    // Grid origin at siteX/siteY, extend in both directions
    const gridStartX = Math.floor((visLeft - siteX) / gridSpacingPx) * gridSpacingPx + siteX;
    const gridStartY = Math.floor((visTop - siteY) / gridSpacingPx) * gridSpacingPx + siteY;

    ctx.strokeStyle = "hsl(225, 15%, 17%)";
    ctx.lineWidth = 0.4;

    for (let px = gridStartX; px <= visRight; px += gridSpacingPx) {
      ctx.beginPath();
      ctx.moveTo(px, visTop);
      ctx.lineTo(px, visBottom);
      ctx.stroke();
    }
    for (let py = gridStartY; py <= visBottom; py += gridSpacingPx) {
      ctx.beginPath();
      ctx.moveTo(visLeft, py);
      ctx.lineTo(visRight, py);
      ctx.stroke();
    }

    // Bolder lines every 1m
    ctx.strokeStyle = "hsl(225, 15%, 22%)";
    ctx.lineWidth = 0.7;
    const majorSpacingPx = 1 * ppm;
    const majorStartX = Math.floor((visLeft - siteX) / majorSpacingPx) * majorSpacingPx + siteX;
    const majorStartY = Math.floor((visTop - siteY) / majorSpacingPx) * majorSpacingPx + siteY;

    for (let px = majorStartX; px <= visRight; px += majorSpacingPx) {
      ctx.beginPath();
      ctx.moveTo(px, visTop);
      ctx.lineTo(px, visBottom);
      ctx.stroke();
    }
    for (let py = majorStartY; py <= visBottom; py += majorSpacingPx) {
      ctx.beginPath();
      ctx.moveTo(visLeft, py);
      ctx.lineTo(visRight, py);
      ctx.stroke();
    }

    // Grid axis labels (every 2m along warehouse edges)
    ctx.fillStyle = "hsl(225, 15%, 35%)";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let gx = 0; gx <= params.length; gx += 2) {
      drawReadableText(`${gx}`, siteX + gx * ppm, siteY - 12);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let gy = 0; gy <= params.width; gy += 2) {
      drawReadableText(`${gy}`, siteX - 5, siteY + gy * ppm);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    // Warehouse boundary
    ctx.strokeStyle = "hsl(170, 70%, 40%)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(siteX, siteY, siteW, siteH);
    ctx.setLineDash([]);

    // Dimension labels
    ctx.fillStyle = "hsl(170, 70%, 50%)";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    drawReadableText(`${params.length}m`, siteX + siteW / 2, siteY + siteH + 20);
    drawReadableText(`${params.width}m`, siteX - 25, siteY + siteH / 2, -Math.PI / 2);

    const layoutW = contentW * ppm;
    const layoutH = contentH * ppm;
    const woX = warehouseOffset.x;
    const woY = warehouseOffset.y;
    const startX = originX - layoutW / 2 + woX + (leftExtra * ppm) / 2;
    const startY = originY - layoutH / 2 + woY;

    const slotW = SLOT_W_M * ppm;
    const slotD = SLOT_D_M * ppm;
    const aisleH = AISLE_W_M * ppm;
    const rackGapPx = rackGap * ppm;
    const amrPathWPx = amrPathW_m * ppm;

    // shuttleAnimMapRef is used per-aisle in the drawing loop below
    const trayColor = componentStyles.tray.color;
    const shuttleColor = componentStyles.shuttle.color;
    const railColor = componentStyles.rail.color;

    // ====== AMR Path (dual-lane narrow lines) ======
    const pathCenterLeft = startX - pathMargin_m * ppm - amrPathWPx / 2;
    const pathCenterRight = startX + layoutW + pathMargin_m * ppm + amrPathWPx / 2;
    const pathCenterTop = startY - pathMargin_m * ppm - amrPathWPx / 2;
    const pathCenterBottom = startY + layoutH + pathMargin_m * ppm + amrPathWPx / 2;

    const pathColor = "hsl(220, 10%, 30%)";
    const laneOffsetPx = (LANE_GAP_M / 2) * ppm;

    // Helper: draw two parallel lines for a path segment
    const drawDualLane = (x1: number, y1: number, x2: number, y2: number, isHorizontal: boolean) => {
      ctx.strokeStyle = pathColor;
      ctx.lineWidth = LANE_LINE_W_PX;
      if (isHorizontal) {
        ctx.beginPath();
        ctx.moveTo(x1, y1 - laneOffsetPx);
        ctx.lineTo(x2, y2 - laneOffsetPx);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1, y1 + laneOffsetPx);
        ctx.lineTo(x2, y2 + laneOffsetPx);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x1 - laneOffsetPx, y1);
        ctx.lineTo(x2 - laneOffsetPx, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1 + laneOffsetPx, y1);
        ctx.lineTo(x2 + laneOffsetPx, y2);
        ctx.stroke();
      }
    };

    // Perimeter dual-lanes as two closed loops (prevents corner gaps/overflow)
    ctx.strokeStyle = pathColor;
    ctx.lineWidth = LANE_LINE_W_PX;

    // Outer loop
    ctx.beginPath();
    ctx.moveTo(pathCenterLeft - laneOffsetPx, pathCenterTop - laneOffsetPx);
    ctx.lineTo(pathCenterRight + laneOffsetPx, pathCenterTop - laneOffsetPx);
    ctx.lineTo(pathCenterRight + laneOffsetPx, pathCenterBottom + laneOffsetPx);
    ctx.lineTo(pathCenterLeft - laneOffsetPx, pathCenterBottom + laneOffsetPx);
    ctx.closePath();
    ctx.stroke();

    // Inner loop
    ctx.beginPath();
    ctx.moveTo(pathCenterLeft + laneOffsetPx, pathCenterTop + laneOffsetPx);
    ctx.lineTo(pathCenterRight - laneOffsetPx, pathCenterTop + laneOffsetPx);
    ctx.lineTo(pathCenterRight - laneOffsetPx, pathCenterBottom - laneOffsetPx);
    ctx.lineTo(pathCenterLeft + laneOffsetPx, pathCenterBottom - laneOffsetPx);
    ctx.closePath();
    ctx.stroke();

    // Internal horizontal crossings through gaps
    for (let a = 1; a < numAisles; a++) {
      if (a % 2 === 0) {
        const gapCenterY = startY + aisleYOffset(a, numAisles, aisleGroupH) * ppm - (GAP_BETWEEN_PAIRS * ppm) / 2;
        drawDualLane(pathCenterLeft, gapCenterY, pathCenterRight, gapCenterY, true);
      }
    }

    // ====== Packing Stations: vertical column parallel to AMR path, with gaps ======
    const stationWPx = stationW_m * ppm;
    const stationHPx = stationH_m * ppm;
    const stationGapPx = stationGap_m * ppm;
    const totalStationsH = stations * stationHPx + (stations - 1) * stationGapPx;
    const stationsX = pathCenterLeft - amrPathWPx / 2 - pathMargin_m * ppm * 0.5 - stationWPx;
    const stationsStartY = startY + layoutH / 2 - totalStationsH / 2;
    const packingInnerInset = 1;
    const packingSlotCellW = Math.min(slotW * 0.9, stationWPx - packingInnerInset * 2);
    const desiredPackingGap = Math.max(0.05, slotD * 0.005);
    const maxPackingCellH =
      (stationHPx - packingInnerInset * 2 - (packingSlotsPerStation - 1) * desiredPackingGap) / packingSlotsPerStation;
    const packingSlotCellH = Math.min(slotD * 0.82, maxPackingCellH);
    const packingSlotGap = Math.max(
      0,
      Math.min(
        desiredPackingGap,
        (stationHPx - packingInnerInset * 2 - packingSlotsPerStation * packingSlotCellH) /
          Math.max(packingSlotsPerStation - 1, 1),
      ),
    );
    const packingStackH = packingSlotsPerStation * packingSlotCellH + (packingSlotsPerStation - 1) * packingSlotGap;
    const getPackingSlotCenterY = (stationIdx: number, slotIdx: number) => {
      const stationY = stationsStartY + stationIdx * (stationHPx + stationGapPx);
      const slotPadY = Math.max(packingInnerInset, (stationHPx - packingStackH) / 2);
      return stationY + slotPadY + slotIdx * (packingSlotCellH + packingSlotGap) + packingSlotCellH / 2;
    };

    for (let s = 0; s < stations; s++) {
      const sx = stationsX;
      const sy = stationsStartY + s * (stationHPx + stationGapPx);

      // Station body with purple frame and dark interior (reference style)
      ctx.fillStyle = "hsl(226, 20%, 16%)";
      ctx.beginPath();
      ctx.roundRect(sx, sy, stationWPx, stationHPx, 7);
      ctx.fill();
      ctx.strokeStyle = "hsla(276, 70%, 78%, 0.9)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = "hsla(276, 85%, 82%, 0.14)";
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Draw vertical stack of slots to match reference direction
      const slotCellW = packingSlotCellW;
      const slotCellH = packingSlotCellH;
      const cellGap = packingSlotGap;
      const slotPadX = (stationWPx - slotCellW) / 2;
      const slotPadY = Math.max(packingInnerInset, (stationHPx - packingStackH) / 2);

      const centerSlotIdx = Math.floor(packingSlotsPerStation / 2);
      for (let c = 0; c < packingSlotsPerStation; c++) {
        const cellX = sx + slotPadX;
        const cellY = sy + slotPadY + c * (slotCellH + cellGap);
        const rotatedW = slotCellH;
        const rotatedH = slotCellW;
        const cx = cellX + (slotCellW - rotatedW) / 2;
        const cy = cellY + (slotCellH - rotatedH) / 2;
        const ch = rotatedH;

        const isCenter = c === centerSlotIdx;
        const isDropped = filledPackingSlotsRef.current.has(`${s}-${c}`);
        ctx.fillStyle = isCenter ? "hsl(210, 72%, 57%)" : isDropped ? "hsl(220, 12%, 72%)" : "hsl(223, 24%, 20%)";
        ctx.beginPath();
        ctx.roundRect(cx, cy, rotatedW, ch, 3);
        ctx.fill();
        ctx.strokeStyle = isCenter ? "hsl(207, 86%, 74%)" : isDropped ? "hsl(220, 15%, 82%)" : "hsl(224, 22%, 34%)";
        ctx.lineWidth = 1.1;
        ctx.stroke();

        if (isCenter) {
          ctx.strokeStyle = "hsla(0, 0%, 100%, 0.28)";
          ctx.lineWidth = 0.8;
          const hiW = rotatedW - 3;
          const hiH = Math.max(ch * 0.35, 3);
          ctx.beginPath();
          ctx.roundRect(cx + 1.5, cy + 1.5, hiW, hiH, 2);
          ctx.stroke();
        }
      }

      // One single-line branch path per slot
      const packingJoinX = pathCenterLeft - laneOffsetPx;
      for (let c = 0; c < packingSlotsPerStation; c++) {
        const slotCenterY = getPackingSlotCenterY(s, c);
        ctx.strokeStyle = pathColor;
        ctx.lineWidth = LANE_LINE_W_PX;
        ctx.beginPath();
        ctx.moveTo(sx + stationWPx, slotCenterY);
        ctx.lineTo(packingJoinX, slotCenterY);
        ctx.stroke();
      }
    }

    // "Packing Area" label (vertical)
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "hsl(270, 50%, 65%)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawReadableText("Packing Area", stationsX - 12, stationsStartY + totalStationsH / 2, -Math.PI / 2);

    // ====== Single Delivery Station at top near x=5m, y=2m ======
    const deliveryWPx = deliveryW_m * ppm;
    const deliveryHPx = deliveryH_m * ppm;
    // Keep X near previous position, but place entire station with fixed gap from top AMR path
    const deliveryCenterPx_x = siteX + 7 * ppm;
    const deliveryGapFromTopPathPx = 1.0 * ppm;
    const deliveryCenterPx_y = pathCenterTop - deliveryGapFromTopPathPx - deliveryHPx / 2;
    const deliveryDx = deliveryCenterPx_x - deliveryWPx / 2;
    const deliveryDy = deliveryCenterPx_y - deliveryHPx / 2;

    // Station base/conveyor (bottom edge)
    ctx.fillStyle = "hsl(160, 30%, 55%)";
    ctx.beginPath();
    ctx.roundRect(deliveryDx + 4, deliveryDy + deliveryHPx - 6, deliveryWPx - 8, 7, 3);
    ctx.fill();

    // Station shelf/background
    ctx.fillStyle = "hsl(160, 15%, 30%)";
    ctx.beginPath();
    ctx.roundRect(deliveryDx, deliveryDy, deliveryWPx, deliveryHPx, 5);
    ctx.fill();
    ctx.strokeStyle = "hsl(160, 30%, 45%)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Draw horizontal row of slots
    {
      const slotPadX = (deliveryWPx - deliverySlots * slotW) / 2;
      const slotPadY = (deliveryHPx - slotD) / 2;

      for (let c = 0; c < deliverySlots; c++) {
        const cx2 = deliveryDx + slotPadX + c * slotW;
        const cy2 = deliveryDy + slotPadY;
        const cw = slotW;

        const isFilled = c % 3 === 0;
        ctx.fillStyle = isFilled ? trayColor : "hsl(160, 14%, 18%)";
        ctx.beginPath();
        ctx.roundRect(cx2, cy2, cw, slotD, 3);
        ctx.fill();
        ctx.strokeStyle = isFilled ? "hsl(210, 55%, 72%)" : "hsl(160, 18%, 38%)";
        ctx.lineWidth = 1;
        ctx.stroke();

        if (isFilled) {
          ctx.strokeStyle = "hsla(0, 0%, 100%, 0.28)";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.roundRect(cx2 + 1.5, cy2 + 1.5, cw - 3, Math.max(slotD * 0.38, 3), 2);
          ctx.stroke();
        }
      }
    }

    // Delivery slot paths: single-line branches per slot, with spacing from the top AMR lane
    const deliveryCenterX = deliveryDx + deliveryWPx / 2;
    const deliverySlotPathGap = 1.0 * ppm;
    const deliveryBranchY = pathCenterTop - deliverySlotPathGap;
    const deliverySlotPadX = (deliveryWPx - deliverySlots * slotW) / 2;
    const deliverySlotStartX = deliveryDx + deliverySlotPadX + slotW / 2;
    const deliverySlotEndX = deliverySlotStartX + (deliverySlots - 1) * slotW;

    // one single branch path per delivery slot
    const deliveryJoinY = pathCenterTop - laneOffsetPx;
    for (let c = 0; c < deliverySlots; c++) {
      const slotCenterX = deliverySlotStartX + c * slotW;
      ctx.beginPath();
      ctx.moveTo(slotCenterX, deliveryDy + deliveryHPx);
      ctx.lineTo(slotCenterX, deliveryJoinY);
      ctx.stroke();
    }

    // "Delivery Area" label
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "hsl(160, 50%, 65%)";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    drawReadableText("Delivery Area", deliveryCenterX, deliveryDy - 8);

    // ====== AGV Parking Area: right side, vertical column of parking spots ======
    const parkingSpotWPx = PARKING_SPOT_W_M * ppm;
    const parkingSpotHPx = PARKING_SPOT_H_M * ppm;
    const parkingGapPx = PARKING_GAP_M * ppm;
    const totalParkingH = agvCount * parkingSpotHPx + (agvCount - 1) * parkingGapPx;
    const parkingX = pathCenterRight + PARKING_MARGIN_M * ppm;
    const parkingStartY = startY + layoutH / 2 - totalParkingH / 2;

    // Store parking positions for idle placement
    const parkingPositions: { px: number; py: number; mx: number; my: number }[] = [];

    for (let p = 0; p < agvCount; p++) {
      const py = parkingStartY + p * (parkingSpotHPx + parkingGapPx);
      const spotCenterY = py + parkingSpotHPx / 2;

      // Draw curved path branch from right vertical lane to parking spot
      const branchStartX = pathCenterRight;
      const branchEndX = parkingX;

      // Draw a smooth curved connector
      ctx.strokeStyle = pathColor;
      ctx.lineWidth = LANE_LINE_W_PX;

      // Upper lane curve
      ctx.beginPath();
      ctx.moveTo(branchStartX + laneOffsetPx, spotCenterY - laneOffsetPx);
      const cpOffset = (branchEndX - branchStartX) * 0.5;
      ctx.bezierCurveTo(
        branchStartX + laneOffsetPx + cpOffset,
        spotCenterY - laneOffsetPx,
        branchEndX - cpOffset,
        spotCenterY - laneOffsetPx,
        branchEndX,
        spotCenterY - laneOffsetPx,
      );
      ctx.stroke();

      // Lower lane curve
      ctx.beginPath();
      ctx.moveTo(branchStartX + laneOffsetPx, spotCenterY + laneOffsetPx);
      ctx.bezierCurveTo(
        branchStartX + laneOffsetPx + cpOffset,
        spotCenterY + laneOffsetPx,
        branchEndX - cpOffset,
        spotCenterY + laneOffsetPx,
        branchEndX,
        spotCenterY + laneOffsetPx,
      );
      ctx.stroke();

      // Parking spot background
      ctx.fillStyle = "hsl(30, 15%, 22%)";
      ctx.beginPath();
      ctx.roundRect(parkingX, py, parkingSpotWPx, parkingSpotHPx, 3);
      ctx.fill();
      ctx.strokeStyle = "hsl(30, 40%, 40%)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Direction indicator (small triangle pointing left)
      ctx.fillStyle = "hsl(30, 60%, 50%)";
      ctx.beginPath();
      ctx.moveTo(parkingX + 3, spotCenterY);
      ctx.lineTo(parkingX + 8, spotCenterY - 3);
      ctx.lineTo(parkingX + 8, spotCenterY + 3);
      ctx.closePath();
      ctx.fill();

      // Convert to meters for idle placement
      const spotMX = (parkingX + parkingSpotWPx / 2 - startX) / ppm;
      const spotMY = (spotCenterY - startY) / ppm;
      parkingPositions.push({ px: parkingX + parkingSpotWPx / 2, py: spotCenterY, mx: spotMX, my: spotMY });
    }

    // "AGV Parking" label (vertical, right of parking)
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = "hsl(30, 60%, 65%)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawReadableText("AGV Parking", parkingX + parkingSpotWPx + 14, parkingStartY + totalParkingH / 2, -Math.PI / 2);

    let currentY = startY;

    for (let a = 0; a < numAisles; a++) {
      const aisleTopY = currentY + deep * slotD;

      // Top side racks
      for (let d = 0; d < deep; d++) {
        const y = currentY + d * slotD;
        for (let c = 0; c < racks; c++) {
          const x = startX + c * (slotW + rackGapPx);
          const brightness = 28 + (d / Math.max(deep - 1, 1)) * 10;

          const deepOffset = -(deep - d);
          const trayKey = `${a}-${c}-${deepOffset}`;
          const isRemoved = removedTrays.has(trayKey);
          const isPlaced = placedTrays.some((p) => p.aisle === a && p.rack === c && p.deepOffset === deepOffset);

          if (isRemoved && !isPlaced) {
            ctx.fillStyle = `hsl(210, 20%, ${brightness - 5}%)`;
          } else if (isPlaced) {
            ctx.fillStyle = `hsl(140, 50%, ${brightness + 5}%)`;
          } else {
            ctx.fillStyle = trayColor;
          }

          ctx.beginPath();
          ctx.roundRect(x, y + 1, slotW, slotD - 2, 2);
          ctx.fill();
          ctx.strokeStyle = `hsl(210, 55%, ${brightness + 18}%)`;
          ctx.lineWidth = 1;
          ctx.stroke();

          hitRegions.push({ x, y: y + 1, w: slotW, h: slotD - 2, type: "tray" });
        }
      }

      // Aisle
      ctx.fillStyle = "hsl(225, 15%, 18%)";
      ctx.fillRect(startX, aisleTopY, layoutW, aisleH);

      // Rail lines
      const railY1 = aisleTopY + aisleH * 0.3;
      const railY2 = aisleTopY + aisleH * 0.7;
      ctx.strokeStyle = railColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, railY1);
      ctx.lineTo(startX + layoutW, railY1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(startX, railY2);
      ctx.lineTo(startX + layoutW, railY2);
      ctx.stroke();

      hitRegions.push({ x: startX, y: railY1 - 3, w: layoutW, h: 6, type: "rail" });
      hitRegions.push({ x: startX, y: railY2 - 3, w: layoutW, h: 6, type: "rail" });

      // Dashed center line in aisle
      ctx.strokeStyle = "hsl(40, 80%, 55%)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(startX, aisleTopY + aisleH / 2);
      ctx.lineTo(startX + layoutW, aisleTopY + aisleH / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const aisleAnim = shuttleAnimMapRef.current.get(a);
      const aisleIsAnimating = aisleAnim ? aisleAnim.phase !== "idle" && aisleAnim.phase !== "done" : false;
      const shuttleCenterY = aisleTopY + aisleH / 2;
      const sSize = Math.min(aisleH * 0.9, slotW * 0.7);

      // Draw two shuttles per aisle
      for (let si = 0; si < 2; si++) {
        const isActiveShuttle = aisleIsAnimating && aisleAnim!.activeShuttleIdx === si;
        const idlePos = si === 0 ? Math.floor((racks - 1) * 0.25) : Math.floor((racks - 1) * 0.75);
        const shuttleRackIdx = isActiveShuttle ? aisleAnim!.shuttleRackPos : idlePos;
        const shuttleX = startX + shuttleRackIdx * (slotW + rackGapPx) + slotW / 2;

        // Draw fork extension for active shuttle
        if (isActiveShuttle && Math.abs(aisleAnim!.forkExtend) > 0.01) {
          const forkLength = Math.abs(aisleAnim!.forkExtend) * slotD;
          const forkDir = aisleAnim!.forkExtend < 0 ? -1 : 1;
          const forkStartY = shuttleCenterY;
          const forkEndY = forkStartY + forkDir * forkLength;

          ctx.strokeStyle = "hsl(40, 70%, 50%)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(shuttleX, forkStartY);
          ctx.lineTo(shuttleX, forkEndY);
          ctx.stroke();

          if (aisleAnim!.hasTray) {
            ctx.fillStyle = trayColor;
            ctx.beginPath();
            ctx.roundRect(shuttleX - slotW * 0.35, forkEndY - slotD * 0.2, slotW * 0.7, slotD * 0.4, 2);
            ctx.fill();
          }
        }

        drawShuttle(ctx, shuttleX, shuttleCenterY, sSize, shuttleColor);

        hitRegions.push({
          x: shuttleX - sSize / 2,
          y: shuttleCenterY - sSize / 2,
          w: sSize,
          h: sSize,
          type: "shuttle",
        });
      }

      // Bottom side racks
      for (let d = 0; d < deep; d++) {
        const y = aisleTopY + aisleH + d * slotD;
        for (let c = 0; c < racks; c++) {
          const x = startX + c * (slotW + rackGapPx);
          const brightness = 28 + ((deep - 1 - d) / Math.max(deep - 1, 1)) * 10;

          const deepOffset = d + 1;
          const trayKey = `${a}-${c}-${deepOffset}`;
          const isRemoved = removedTrays.has(trayKey);
          const isPlaced = placedTrays.some((p) => p.aisle === a && p.rack === c && p.deepOffset === deepOffset);

          if (isRemoved && !isPlaced) {
            ctx.fillStyle = `hsl(210, 20%, ${brightness - 5}%)`;
          } else if (isPlaced) {
            ctx.fillStyle = `hsl(140, 50%, ${brightness + 5}%)`;
          } else {
            ctx.fillStyle = trayColor;
          }

          ctx.beginPath();
          ctx.roundRect(x, y + 1, slotW, slotD - 2, 2);
          ctx.fill();
          ctx.strokeStyle = `hsl(210, 55%, ${brightness + 18}%)`;
          ctx.lineWidth = 1;
          ctx.stroke();

          hitRegions.push({ x, y: y + 1, w: slotW, h: slotD - 2, type: "tray" });
        }
      }

      currentY += aisleGroupH * ppm;
      if (a % 2 === 1 && a < numAisles - 1) currentY += GAP_BETWEEN_PAIRS * ppm;
    }

    // ====== Helper: convert pixel world coords to meters relative to warehouse origin ======
    const toMX = (px: number) => (px - startX) / ppm;
    const toMY = (py: number) => (py - startY) / ppm;

    // ====== Initialize idle positions for all AGVs in the map ======
    for (const agv of agvList) {
      if (!amrAnimMapRef.current.has(agv.agv_id)) {
        const st = createDefaultAMRState();
        st.initialized = true;
        amrAnimMapRef.current.set(agv.agv_id, st);
      }
    }

    // ====== Compute AMR waypoints if needed (in meters) ======
    const laneOffsetM = LANE_GAP_M / 2;
    const pathTopM = toMY(pathCenterTop);
    const pathBottomM = toMY(pathCenterBottom);
    const pathLeftM = toMX(pathCenterLeft);
    const pathRightM = toMX(pathCenterRight);
    const horizontalPathsM: number[] = [pathTopM];

    for (let a = 1; a < numAisles; a++) {
      if (a % 2 === 0) {
        const gapCenterY = startY + aisleYOffset(a, numAisles, aisleGroupH) * ppm - (GAP_BETWEEN_PAIRS * ppm) / 2;
        horizontalPathsM.push(toMY(gapCenterY));
      }
    }

    horizontalPathsM.push(pathBottomM);

    const getAgvLane = (agvId: number) => {
      const agvIdx = agvList.findIndex((agv) => agv.agv_id === agvId);
      return agvIdx >= 0 ? agvIdx % 2 : 0;
    };
    const laneOffsetFor = (lane: number) => (lane === 0 ? -laneOffsetM : laneOffsetM);
    const laneX = (side: "left" | "right", lane: number) =>
      (side === "left" ? pathLeftM : pathRightM) + laneOffsetFor(lane);
    const laneY = (pathY: number, lane: number) => pathY + laneOffsetFor(lane);
    const nearlySamePoint = (a: { mx: number; my: number }, b: { mx: number; my: number }) =>
      Math.abs(a.mx - b.mx) < 0.001 && Math.abs(a.my - b.my) < 0.001;

    type IdleSegment = { kind: "left-vertical" } | { kind: "right-vertical" } | { kind: "horizontal"; pathY: number };

    type IdlePlacement = {
      mx: number;
      my: number;
      segment: IdleSegment;
    };

    // Each AGV gets parked in the right-side parking area
    const computeIdlePlacement = (agvId: number): IdlePlacement => {
      const agvIdx = agvList.findIndex((a) => a.agv_id === agvId);
      const idx = agvIdx >= 0 ? agvIdx : 0;
      const parkIdx = idx % parkingPositions.length;
      const spot = parkingPositions[parkIdx];
      if (spot) {
        return { mx: spot.mx, my: spot.my, segment: { kind: "right-vertical" } };
      }
      // Fallback: right vertical lane
      return { mx: pathRightM + laneOffsetM, my: pathTopM + laneOffsetM, segment: { kind: "right-vertical" } };
    };

    const appendWaypoint = (points: { mx: number; my: number }[], point: { mx: number; my: number }) => {
      const last = points[points.length - 1];
      if (!last || !nearlySamePoint(last, point)) {
        points.push(point);
      }
    };

    // Find the nearest real horizontal path (with lane offset) to a given Y
    const findNearestHorizontalPath = (fromY: number, lane: number): number => {
      let best = laneY(horizontalPathsM[0], lane);
      let bestDist = Math.abs(fromY - best);
      for (const py of horizontalPathsM) {
        const ly = laneY(py, lane);
        const d = Math.abs(fromY - ly);
        if (d < bestDist) {
          bestDist = d;
          best = ly;
        }
      }
      return best;
    };

    // Build route strictly along the visible AMR lane lines.
    // Horizontal travel stays on the chosen lane line, and lane changes happen only via the left/right vertical lane lines.
    const buildRouteToPoint = (
      startMX: number,
      startMY: number,
      startSegment: IdleSegment,
      targetMX: number,
      targetPathY: number,
      lane: number,
    ) => {
      const route: { mx: number; my: number }[] = [];
      appendWaypoint(route, { mx: startMX, my: startMY });

      const leftVerticalMX = laneX("left", lane);
      const rightVerticalMX = laneX("right", lane);
      const startPathY = startSegment.kind === "horizontal" ? startMY : null;

      if (startPathY !== null && Math.abs(startPathY - targetPathY) < 0.01) {
        appendWaypoint(route, { mx: targetMX, my: targetPathY });
        return route;
      }

      if (startSegment.kind === "left-vertical" || startSegment.kind === "right-vertical") {
        // From parking: go horizontally to the vertical lane, then strictly on AMR grid
        const verticalLaneMX = startSegment.kind === "right-vertical" ? rightVerticalMX : leftVerticalMX;
        // Step 1: horizontal move from parking spot to the vertical lane
        if (Math.abs(startMX - verticalLaneMX) > 0.01) {
          appendWaypoint(route, { mx: verticalLaneMX, my: startMY });
        }
        // Step 2: vertical move on the lane to the nearest real horizontal path
        const nearestHP = findNearestHorizontalPath(startMY, lane);
        appendWaypoint(route, { mx: verticalLaneMX, my: nearestHP });

        // Check if targetPathY is on a real horizontal path or a branch
        const isTargetOnRealPath = horizontalPathsM.some((hp) => Math.abs(laneY(hp, lane) - targetPathY) < 0.01);

        if (isTargetOnRealPath && Math.abs(nearestHP - targetPathY) < 0.01) {
          // Already on the right horizontal path, just go to target X
          appendWaypoint(route, { mx: targetMX, my: targetPathY });
        } else if (isTargetOnRealPath) {
          // Target is on a different real horizontal path — travel on horizontal to a vertical lane, then vertical
          // Choose which vertical lane is closer to the target
          const distToLeft = Math.abs(targetMX - leftVerticalMX);
          const distToRight = Math.abs(targetMX - rightVerticalMX);
          const viaX = distToLeft <= distToRight ? leftVerticalMX : rightVerticalMX;
          // If we're not already on that vertical lane, go horizontally to it first
          if (Math.abs(verticalLaneMX - viaX) > 0.01) {
            appendWaypoint(route, { mx: viaX, my: nearestHP });
          }
          appendWaypoint(route, { mx: viaX, my: targetPathY });
          appendWaypoint(route, { mx: targetMX, my: targetPathY });
        } else {
          // Target is on a branch (e.g. station branch) — route via left vertical lane
          // Go horizontally on the nearest path to the left lane
          appendWaypoint(route, { mx: leftVerticalMX, my: nearestHP });
          // Then vertically on left lane to the branch Y
          appendWaypoint(route, { mx: leftVerticalMX, my: targetPathY });
          // Then horizontally on the branch to the target
          appendWaypoint(route, { mx: targetMX, my: targetPathY });
        }
        return route;
      }

      const distToLeft = Math.abs(startMX - leftVerticalMX) + Math.abs(targetMX - leftVerticalMX);
      const distToRight = Math.abs(startMX - rightVerticalMX) + Math.abs(targetMX - rightVerticalMX);
      const viaX = distToLeft <= distToRight ? leftVerticalMX : rightVerticalMX;

      appendWaypoint(route, { mx: viaX, my: startPathY! });
      appendWaypoint(route, { mx: viaX, my: targetPathY });
      appendWaypoint(route, { mx: targetMX, my: targetPathY });
      return route;
    };

    // ====== Compute waypoints for ALL active AGVs in the map ======
    amrAnimMapRef.current.forEach((amrSt, agvId) => {
      if (amrSt.phase !== "to_source" || amrSt.sourceWaypoints.length > 0) return;
      const order = amrSt.order;
      if (!order) return;

      const idlePlacement = computeIdlePlacement(agvId);

      if (amrSt.mx === 0 && amrSt.my === 0) {
        amrSt.mx = idlePlacement.mx;
        amrSt.my = idlePlacement.my;
      }
      const curMX = amrSt.mx;
      const curMY = amrSt.my;

      if (
        order.manualMode &&
        order.sourceX != null &&
        order.sourceY != null &&
        order.destX != null &&
        order.destY != null
      ) {
        const srcMX = (siteX + order.sourceX * ppm - startX) / ppm;
        const srcMY = (siteY + order.sourceY * ppm - startY) / ppm;
        const dstMX = (siteX + order.destX * ppm - startX) / ppm;
        const dstMY = (siteY + order.destY * ppm - startY) / ppm;

        amrSt.sourceWaypoints = [
          { mx: curMX, my: curMY },
          { mx: srcMX, my: curMY },
          { mx: srcMX, my: srcMY },
        ];
        amrSt.stationWaypoints = [
          { mx: srcMX, my: srcMY },
          { mx: dstMX, my: srcMY },
          { mx: dstMX, my: dstMY },
        ];
        amrSt.returnWaypoints = [
          { mx: dstMX, my: dstMY },
          { mx: idlePlacement.mx, my: dstMY },
          { mx: idlePlacement.mx, my: idlePlacement.my },
        ];
        amrSt.mx = curMX;
        amrSt.my = curMY;
        amrSt.sourceWpIdx = 1;
        amrSt.stationWpIdx = 1;
        amrSt.returnWpIdx = 1;
      } else if (order.flowType === "rack-to-station") {
        // ====== OLD FLOW: rack slot → packing station ======
        const agvLaneLocal = getAgvLane(agvId);

        const rackRow = order.rackRow ?? 1;
        const rackRack = (order.rackRack ?? 1) - 1;
        const rackDeep = order.rackDeep ?? 1;
        const { aisleIdx, side } = rowToAisleSide(rackRow);
        const aisleTopPx = startY + aisleYOffset(aisleIdx, numAisles, aisleGroupH) * ppm;
        const rackXPx = startX + rackRack * (slotW + rackGapPx) + slotW / 2;

        let deepSlotPx: number;
        if (side === "top") {
          deepSlotPx = aisleTopPx + (deep - rackDeep) * slotD + slotD / 2;
        } else {
          deepSlotPx = aisleTopPx + deep * slotD + aisleH + (rackDeep - 1) * slotD + slotD / 2;
        }

        const srcMX = toMX(rackXPx);
        const srcMY = toMY(deepSlotPx);

        const destStationIdx = Math.min(Math.max((order.destStation ?? 1) - 1, 0), stations - 1);
        const reservePackingSlot = (stationIdx: number) => {
          const centerIdx = Math.floor(packingSlotsPerStation / 2);
          const availableNonAdjacent: number[] = [];
          const availableAny: number[] = [];

          const isOccupied = (idx: number) => {
            const key = `${stationIdx}-${idx}`;
            return filledPackingSlotsRef.current.has(key) || reservedPackingSlotsRef.current.has(key);
          };

          for (let idx = 0; idx < packingSlotsPerStation; idx++) {
            if (idx === centerIdx) continue; // keep center slot reserved as permanent blue marker
            if (isOccupied(idx)) continue;
            availableAny.push(idx);
            const leftBlocked = idx - 1 >= 0 && isOccupied(idx - 1);
            const rightBlocked = idx + 1 < packingSlotsPerStation && isOccupied(idx + 1);
            if (!leftBlocked && !rightBlocked) availableNonAdjacent.push(idx);
          }

          const pick = (list: number[]) => list[Math.floor(Math.random() * list.length)];
          const chosen =
            availableNonAdjacent.length > 0
              ? pick(availableNonAdjacent)
              : availableAny.length > 0
                ? pick(availableAny)
                : -1;

          if (chosen >= 0) {
            reservedPackingSlotsRef.current.add(`${stationIdx}-${chosen}`);
            return chosen;
          }

          // No free non-center slot left; fallback to slot 0.
          return 0;
        };
        const destSlotIdx = reservePackingSlot(destStationIdx);
        const destSy = getPackingSlotCenterY(destStationIdx, destSlotIdx);
        const destSx = stationsX + stationWPx;
        const destMX = toMX(destSx);
        const destMY = toMY(destSy);

        const leftLaneMX = laneX("left", agvLaneLocal);
        const rightLaneMX = laneX("right", agvLaneLocal);
        // Use the exact selected slot branch (no lane-offset detour)
        const stationBranchMY = destMY;
        const curSegment = idlePlacement.segment;

        let nearestRackPathMY = horizontalPathsM[0];
        let nearestRackDist = Infinity;
        for (const py of horizontalPathsM) {
          const d = Math.abs(srcMY - py);
          if (d < nearestRackDist) {
            nearestRackDist = d;
            nearestRackPathMY = py;
          }
        }
        const rackPathMY = laneY(nearestRackPathMY, agvLaneLocal);

        const srcWps = buildRouteToPoint(curMX, curMY, curSegment, srcMX, rackPathMY, agvLaneLocal);
        appendWaypoint(srcWps, { mx: srcMX, my: srcMY });

        const stWps: { mx: number; my: number }[] = [];
        appendWaypoint(stWps, { mx: srcMX, my: srcMY });
        appendWaypoint(stWps, { mx: srcMX, my: rackPathMY });
        appendWaypoint(stWps, { mx: leftLaneMX, my: rackPathMY });
        appendWaypoint(stWps, { mx: leftLaneMX, my: stationBranchMY });
        appendWaypoint(stWps, { mx: destMX, my: stationBranchMY });
        appendWaypoint(stWps, { mx: destMX, my: destMY });

        // Return: retrace the same path back to parking
        const returnWps: { mx: number; my: number }[] = [];
        appendWaypoint(returnWps, { mx: destMX, my: destMY });
        appendWaypoint(returnWps, { mx: destMX, my: stationBranchMY });
        appendWaypoint(returnWps, { mx: leftLaneMX, my: stationBranchMY });
        // Go on left lane to the rack horizontal path (same one used going)
        appendWaypoint(returnWps, { mx: leftLaneMX, my: rackPathMY });
        // Horizontal on that path to right vertical lane
        appendWaypoint(returnWps, { mx: rightLaneMX, my: rackPathMY });
        // Vertical on right lane to parking row
        appendWaypoint(returnWps, { mx: rightLaneMX, my: idlePlacement.my });
        // Horizontal into parking spot
        appendWaypoint(returnWps, { mx: idlePlacement.mx, my: idlePlacement.my });

        amrSt.sourceWaypoints = srcWps;
        amrSt.stationWaypoints = stWps;
        amrSt.returnWaypoints = returnWps;
        amrSt.targetPackingStationIdx = destStationIdx;
        amrSt.targetPackingSlotIdx = destSlotIdx;
        amrSt.mx = srcWps[0].mx;
        amrSt.my = srcWps[0].my;
        amrSt.sourceWpIdx = 1;
        amrSt.stationWpIdx = 1;
        amrSt.returnWpIdx = 1;
      } else {
        // ====== NEW FLOW: packing station → delivery area ======
        const agvLaneLocal = getAgvLane(agvId);
        amrSt.targetPackingStationIdx = -1;
        amrSt.targetPackingSlotIdx = -1;

        const srcStationIdx = (order.sourceStation || 1) - 1;
        const srcSy = stationsStartY + srcStationIdx * (stationHPx + stationGapPx) + stationHPx / 2;
        const srcSx = stationsX + stationWPx;
        const srcMX = toMX(srcSx);
        const srcMY = toMY(srcSy);

        const destDx = deliveryDx + deliveryWPx / 2;
        const destDy = deliveryDy + deliveryHPx;
        const destMX = toMX(destDx);
        const destMY = toMY(destDy);

        const leftLaneMX = laneX("left", agvLaneLocal);
        const rightLaneMX = laneX("right", agvLaneLocal);
        const srcBranchMY = laneY(srcMY, agvLaneLocal);
        const topPathMY = laneY(horizontalPathsM[0], agvLaneLocal);
        const deliveryBranchMX = destMX + laneOffsetFor(agvLaneLocal);
        const curSegment = idlePlacement.segment;

        const srcWps = buildRouteToPoint(curMX, curMY, curSegment, leftLaneMX, srcBranchMY, agvLaneLocal);
        appendWaypoint(srcWps, { mx: srcMX, my: srcBranchMY });
        appendWaypoint(srcWps, { mx: srcMX, my: srcMY });

        const stWps: { mx: number; my: number }[] = [];
        appendWaypoint(stWps, { mx: srcMX, my: srcMY });
        appendWaypoint(stWps, { mx: srcMX, my: srcBranchMY });
        appendWaypoint(stWps, { mx: leftLaneMX, my: srcBranchMY });
        appendWaypoint(stWps, { mx: leftLaneMX, my: topPathMY });
        appendWaypoint(stWps, { mx: deliveryBranchMX, my: topPathMY });
        appendWaypoint(stWps, { mx: deliveryBranchMX, my: destMY });
        appendWaypoint(stWps, { mx: destMX, my: destMY });

        // Return: retrace the same route back to parking via AMR paths
        const returnWps: { mx: number; my: number }[] = [];
        appendWaypoint(returnWps, { mx: destMX, my: destMY });
        appendWaypoint(returnWps, { mx: deliveryBranchMX, my: destMY });
        appendWaypoint(returnWps, { mx: deliveryBranchMX, my: topPathMY });
        // Go on top path to right vertical lane
        appendWaypoint(returnWps, { mx: rightLaneMX, my: topPathMY });
        // Vertical on right lane to parking row
        appendWaypoint(returnWps, { mx: rightLaneMX, my: idlePlacement.my });
        // Horizontal into parking spot
        appendWaypoint(returnWps, { mx: idlePlacement.mx, my: idlePlacement.my });

        amrSt.sourceWaypoints = srcWps;
        amrSt.stationWaypoints = stWps;
        amrSt.returnWaypoints = returnWps;
        amrSt.mx = srcWps[0].mx;
        amrSt.my = srcWps[0].my;
        amrSt.sourceWpIdx = 1;
        amrSt.stationWpIdx = 1;
        amrSt.returnWpIdx = 1;
      }
    });

    // ====== Draw ALL AGVs (idle ones + animated ones) ======
    for (let i = 0; i < agvCount; i++) {
      const agv = agvList[i];
      const agvAnimState = amrAnimMapRef.current.get(agv.agv_id);
      let amrMX: number, amrMY: number;
      let phase: AMRPhase = "idle";
      let hasTrayNow = false;

      if (agvAnimState && agvAnimState.phase !== "idle" && agvAnimState.phase !== "done") {
        amrMX = agvAnimState.mx;
        amrMY = agvAnimState.my;
        phase = agvAnimState.phase;
        hasTrayNow = agvAnimState.hasTray;
      } else {
        const idleP = computeIdlePlacement(agv.agv_id);
        amrMX = idleP.mx;
        amrMY = idleP.my;
      }

      const amrX = startX + amrMX * ppm;
      const amrY = startY + amrMY * ppm;

      const amrW = 10;
      const amrH2 = 10;

      const isPicking = phase === "pickup";
      const isDropping = phase === "dropoff";
      const isStopped = agvAnimState?.stopped ?? false;
      const pulseScale = isPicking || isDropping ? 1 + 0.1 * Math.sin(Date.now() / 100) : 1;
      const drawW = amrW * pulseScale;
      const drawH = amrH2 * pulseScale;
      const agvAngle = agvAnimState?.angle ?? 0;

      // Draw rotated AGV body
      ctx.save();
      ctx.translate(amrX, amrY);
      ctx.rotate(agvAngle);

      ctx.fillStyle = isStopped
        ? "hsl(0, 70%, 45%)"
        : isPicking
          ? "hsl(120, 70%, 45%)"
          : isDropping
            ? "hsl(280, 60%, 50%)"
            : "hsl(30, 80%, 50%)";
      ctx.beginPath();
      ctx.roundRect(-drawW / 2, -drawH / 2, drawW, drawH, 3);
      ctx.fill();
      ctx.strokeStyle = isStopped
        ? "hsl(0, 80%, 60%)"
        : isPicking
          ? "hsl(120, 80%, 60%)"
          : isDropping
            ? "hsl(280, 70%, 65%)"
            : "hsl(30, 90%, 65%)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Direction indicator triangle at front
      ctx.fillStyle = "hsl(0, 0%, 90%)";
      ctx.beginPath();
      ctx.moveTo(drawW / 2 - 1, 0);
      ctx.lineTo(drawW / 2 - 4, -3);
      ctx.lineTo(drawW / 2 - 4, 3);
      ctx.closePath();
      ctx.fill();

      if (hasTrayNow) {
        ctx.fillStyle = trayColor;
        ctx.beginPath();
        ctx.roundRect(-slotW * 0.25, -amrH2 / 2 - slotD * 0.15 - 2, slotW * 0.5, slotD * 0.25, 2);
        ctx.fill();
        ctx.strokeStyle = "hsl(210, 60%, 60%)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      ctx.restore();

      // AGV label (counter-rotated to stay readable)
      ctx.save();
      ctx.translate(amrX, amrY - drawH / 2 - 2);
      ctx.rotate(textFlip);
      ctx.font = "bold 8px monospace";
      const labelColor = isStopped ? "hsl(0, 90%, 70%)" : "hsl(30, 90%, 70%)";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      const label = `AGV ${agv.agv_id}`;
      const lblMetrics = ctx.measureText(label);
      const lblPad = 3;
      const lblBgW = lblMetrics.width + lblPad * 2;
      const lblBgH = 12;
      const lblBgX = -lblBgW / 2;
      const lblBgY = -lblBgH;
      ctx.fillStyle = "hsl(225, 20%, 18%)";
      ctx.beginPath();
      ctx.roundRect(lblBgX, lblBgY, lblBgW, lblBgH, 2);
      ctx.fill();
      ctx.strokeStyle = isStopped ? "hsl(0, 80%, 50%)" : "hsl(30, 80%, 50%)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = labelColor;
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, lblBgY + lblBgH / 2);
      ctx.restore();
    }

    // Store grid info for click handler
    gridInfoRef.current = { ppm, siteX, siteY };

    // ====== Coordinate Tooltip ======
    if (coordTooltip) {
      const tipX = coordTooltip.x;
      const tipY = coordTooltip.y;

      // Crosshair
      ctx.strokeStyle = "hsl(50, 90%, 60%)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(tipX, siteY);
      ctx.lineTo(tipX, siteY + siteH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(siteX, tipY);
      ctx.lineTo(siteX + siteW, tipY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Dot
      ctx.fillStyle = "hsl(50, 90%, 60%)";
      ctx.beginPath();
      ctx.arc(tipX, tipY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Label (counter-rotated)
      const label = `X: ${coordTooltip.mx.toFixed(2)}m  Y: ${coordTooltip.my.toFixed(2)}m`;
      ctx.font = "bold 11px monospace";
      const metrics = ctx.measureText(label);
      const padX = 6;
      const lblW = metrics.width + padX * 2;
      const lblH = 18;

      ctx.save();
      ctx.translate(tipX + 10, tipY - lblH / 2 - 5);
      ctx.rotate(textFlip);

      ctx.fillStyle = "hsl(225, 20%, 15%)";
      ctx.beginPath();
      ctx.roundRect(0, -lblH / 2, lblW, lblH, 3);
      ctx.fill();
      ctx.strokeStyle = "hsl(50, 90%, 60%)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "hsl(50, 90%, 70%)";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, padX, 0);
      ctx.restore();
    }

    ctx.restore();
    hitRegionsRef.current = hitRegions;
  }, [
    params,
    transform,
    rows,
    racks,
    deep,
    numAisles,
    contentW,
    contentH,
    removedTrays,
    placedTrays,
    componentStyles,
    warehouseOffset,
    coordTooltip,
    agvs,
  ]);

  // Keep ref in sync so animation loops always call latest drawCanvas
  drawCanvasRef.current = drawCanvas;

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      setTransform((t) => {
        const cos = Math.cos(t.rotation);
        const sin = Math.sin(t.rotation);
        const ux = (mx - t.x) / t.scale;
        const uy = (my - t.y) / t.scale;
        const wx = ux * cos + uy * sin;
        const wy = -ux * sin + uy * cos;
        const newScale = Math.max(0.1, Math.min(10, t.scale * delta));
        return {
          rotation: t.rotation,
          scale: newScale,
          x: mx - newScale * (cos * wx - sin * wy),
          y: my - newScale * (sin * wx + cos * wy),
        };
      });
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    clickStart.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  };

  const onMouseUp = (e: React.MouseEvent) => {
    isPanning.current = false;

    const dx = e.clientX - clickStart.current.x;
    const dy = e.clientY - clickStart.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const ux = (cx - transform.x) / transform.scale;
    const uy = (cy - transform.y) / transform.scale;
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);
    const wx = ux * cos + uy * sin;
    const wy = -ux * sin + uy * cos;

    // Show coordinate tooltip
    const { ppm, siteX, siteY } = gridInfoRef.current;
    const meterX = (wx - siteX) / ppm;
    const meterY = (wy - siteY) / ppm;
    setCoordTooltip({ x: wx, y: wy, mx: meterX, my: meterY });

    for (let i = hitRegionsRef.current.length - 1; i >= 0; i--) {
      const hr = hitRegionsRef.current[i];
      if (wx >= hr.x && wx <= hr.x + hr.w && wy >= hr.y && wy <= hr.y + hr.h) {
        onComponentClick(hr.type);
        return;
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full cursor-grab active:cursor-grabbing"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        isPanning.current = false;
      }}
    >
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <button
          type="button"
          className="px-2 py-1 text-xs rounded border border-border bg-background/90 hover:bg-muted"
          onClick={() => setTransform((t) => ({ ...t, rotation: t.rotation - Math.PI / 2 }))}
        >
          Rotate L
        </button>
        <button
          type="button"
          className="px-2 py-1 text-xs rounded border border-border bg-background/90 hover:bg-muted"
          onClick={() => setTransform((t) => ({ ...t, rotation: t.rotation + Math.PI / 2 }))}
        >
          Rotate R
        </button>
        <button
          type="button"
          className="px-2 py-1 text-xs rounded border border-border bg-background/90 hover:bg-muted"
          onClick={() => setTransform({ x: 0, y: 0, scale: 1, rotation: 0 })}
        >
          Reset View
        </button>
      </div>
      <canvas ref={canvasRef} className="w-full h-full" style={{ display: "block" }} />
    </div>
  );
}

function drawShuttle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x - size / 2, y - size / 3, size, size * 0.66, 3);
  ctx.fill();

  ctx.fillStyle = "hsl(210, 20%, 50%)";
  ctx.fillRect(x - 1.5, y - size / 2, 3, size);

  ctx.fillStyle = "hsl(210, 25%, 65%)";
  ctx.fillRect(x - size * 0.3, y - size / 3 - 2, size * 0.6, 3);
}
