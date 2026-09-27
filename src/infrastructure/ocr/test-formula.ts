import { message } from "../../domain/messages";

/** Small application-generated fixture for an explicit connection check.
 * Image rendering stays out of the settings UI and application orchestration. */
export function ocrTestImage(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 100;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(message("ocrTestFailed"));
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 480, 100);
    ctx.fillStyle = "black";
    ctx.font = "48px serif";
    ctx.fillText("x² + 1 = 0", 30, 68);
    return canvas.toDataURL("image/png");
  } finally {
    canvas.width = canvas.height = 0;
  }
}
