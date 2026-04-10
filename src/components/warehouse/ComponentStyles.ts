export interface TrayStyle {
  width: number;   // meters
  depth: number;   // meters
  height: number;  // meters
  color: string;   // HSL
}

export interface RackStyle {
  postSize: number;    // meters
  shelfHeight: number; // meters (vertical spacing between levels)
  color: string;       // HSL for posts
  shelfColor: string;  // HSL for shelf rails
}

export interface ShuttleStyle {
  width: number;   // meters
  height: number;  // meters
  depth: number;   // meters
  color: string;   // HSL
}

export interface RailStyle {
  width: number;    // meters (cross-section width)
  height: number;   // meters (cross-section height)
  color: string;    // HSL
}

export interface ComponentStyles {
  tray: TrayStyle;
  rack: RackStyle;
  shuttle: ShuttleStyle;
  rail: RailStyle;
}

export type ComponentType = keyof ComponentStyles;

export const defaultComponentStyles: ComponentStyles = {
  tray: {
    width: 0.35,
    depth: 0.55,
    height: 0.1,
    color: "hsl(210, 70%, 55%)",
  },
  rack: {
    postSize: 0.025,
    shelfHeight: 0.4,
    color: "hsl(210, 10%, 55%)",
    shelfColor: "hsl(210, 15%, 50%)",
  },
  shuttle: {
    width: 0.3,
    height: 0.1,
    depth: 0.3,
    color: "hsl(210, 20%, 45%)",
  },
  rail: {
    width: 0.04,
    height: 0.02,
    color: "hsl(210, 10%, 40%)",
  },
};
