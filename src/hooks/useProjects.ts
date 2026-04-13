import { useState, useCallback, useEffect } from "react";
import type { WarehouseParams } from "@/components/warehouse/WarehouseConfig";
import type { ComponentStyles } from "@/components/warehouse/ComponentStyles";
import { defaultComponentStyles } from "@/components/warehouse/ComponentStyles";

export interface Project {
  id: string;
  name: string;
  params: WarehouseParams;
  componentStyles: ComponentStyles;
  warehouseOffset2D: { x: number; y: number };
  warehouseOffset3D: [number, number];
  createdAt: number;
}

const defaultParams: WarehouseParams = {
  rows: 2,
  racks: 10,
  deep: 2,
  slotsPerRack: 5,
  length: 6,
  width: 5,
  height: 4,
};

const STORAGE_KEY = "warehouse-projects";
const ACTIVE_PROJECT_KEY = "warehouse-active-project";

function generateId() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function loadFromStorage(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveToStorage(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let loaded = loadFromStorage();
    if (loaded.length === 0) {
      const defaultProject: Project = {
        id: generateId(),
        name: "Project 1",
        params: defaultParams,
        componentStyles: defaultComponentStyles,
        warehouseOffset2D: { x: 0, y: 0 },
        warehouseOffset3D: [0, 0],
        createdAt: Date.now(),
      };
      loaded = [defaultProject];
      saveToStorage(loaded);
    }
    setProjects(loaded);

    const savedId = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if (savedId && loaded.some((p) => p.id === savedId)) {
      setActiveId(savedId);
    } else {
      setActiveId(loaded[0].id);
    }
    setLoading(false);
  }, []);

  const activeProject = projects.find((p) => p.id === activeId) || projects[0];

  const persist = useCallback((next: Project[]) => {
    setProjects(next);
    saveToStorage(next);
  }, []);

  const switchProject = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  }, []);

  const addProject = useCallback((name: string) => {
    const proj: Project = {
      id: generateId(),
      name,
      params: defaultParams,
      componentStyles: defaultComponentStyles,
      warehouseOffset2D: { x: 0, y: 0 },
      warehouseOffset3D: [0, 0],
      createdAt: Date.now(),
    };
    const next = [...projects, proj];
    persist(next);
    setActiveId(proj.id);
    localStorage.setItem(ACTIVE_PROJECT_KEY, proj.id);
    return proj;
  }, [projects, persist]);

  const updateProject = useCallback((id: string, updates: Partial<Omit<Project, "id" | "createdAt">>) => {
    const next = projects.map((p) => (p.id === id ? { ...p, ...updates } : p));
    persist(next);
  }, [projects, persist]);

  const deleteProject = useCallback((id: string) => {
    if (projects.length <= 1) return;
    const next = projects.filter((p) => p.id !== id);
    persist(next);
    if (id === activeId) {
      const newActive = next[0].id;
      setActiveId(newActive);
      localStorage.setItem(ACTIVE_PROJECT_KEY, newActive);
    }
  }, [projects, activeId, persist]);

  const renameProject = useCallback((id: string, name: string) => {
    updateProject(id, { name });
  }, [updateProject]);

  return {
    projects,
    activeProject,
    activeId,
    loading,
    switchProject,
    addProject,
    updateProject,
    deleteProject,
    renameProject,
  };
}
