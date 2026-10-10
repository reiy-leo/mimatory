// A window created without a position is centred on tauri's *primary* monitor, so on a Mac with a second
// screen a panel opens where the user is not looking. The main window's frame is read instead — physical
// pixels in the global display space, which is the only coordinate system that says which screen a window
// actually sits on — and the new window's top-left comes back in the logical pixels its options expect.
export interface WindowFrame {
  position: { x: number; y: number }
  scaleFactor: number
  size: { height: number; width: number }
}

export function getTopLeftCenteredOver(input: { frame: WindowFrame; height: number; width: number }): {
  x: number
  y: number
} {
  const { frame, height, width } = input
  const centreX = (frame.position.x + frame.size.width / 2) / frame.scaleFactor
  const centreY = (frame.position.y + frame.size.height / 2) / frame.scaleFactor
  return { x: centreX - width / 2, y: centreY - height / 2 }
}
