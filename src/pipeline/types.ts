export interface Params {
  /** Physical panel width in mm (height follows the crop's aspect ratio). */
  widthMm: number;
  heightMm: number;
  /** Working resolution: millimetres per pixel of the processed image. */
  mmPerPx: number;
  /** Number of glass colors (k-means clusters). */
  colors: number;
  /** Lead line (came) width in mm. */
  cameWidth: number;
  /** Total came height in mm. */
  cameHeight: number;
  /** Glass pane thickness in mm. */
  paneThickness: number;
  /** Outer border width in mm. */
  borderMm: number;
  /** Pieces smaller than this (mm²) are merged into a neighbour. */
  minPieceMm2: number;
  /** Outline simplification tolerance in mm (higher = smoother, less detail). */
  smoothingMm: number;
  /** Mirror the model so the image reads correctly from the bed (viewing) side. */
  mirror: boolean;
}

export const DEFAULT_PARAMS: Params = {
  widthMm: 150,
  heightMm: 150,
  mmPerPx: 0.25,
  colors: 6,
  cameWidth: 1.2,
  cameHeight: 2.0,
  paneThickness: 0.6,
  borderMm: 3,
  minPieceMm2: 8,
  smoothingMm: 0.35,
  mirror: true,
};

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface ImageLike {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface MeshPart {
  name: string;
  /** sRGB hex like #a83232 */
  color: string;
  kind: 'pane' | 'came';
  positions: Float32Array;
  indices: Uint32Array;
  volumeMm3: number;
  /** 2D outline (unmirrored design coordinates, mm, y up) for SVG export. */
  polygons: [number, number][][];
}

export interface DesignResult {
  widthMm: number;
  heightMm: number;
  parts: MeshPart[];
  pieceCount: number;
  timings: Record<string, number>;
}
