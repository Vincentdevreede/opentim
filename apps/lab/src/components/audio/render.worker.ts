/** Renders a sound with the game's FM driver on emulated chips away from the page, so it stays responsive. */

import { readAdlibBank, renderAdlib } from "@opentim/sound";
import type { RenderRequest, RenderResponse } from "./rendering.ts";

addEventListener("message", (e: MessageEvent<RenderRequest>) => {
  const reply = (message: RenderResponse, transfer: Transferable[] = []) => postMessage(message, { transfer });
  try {
    let last = 0;
    const pcm = renderAdlib(e.data.sound, readAdlibBank(e.data.patch), {
      card: e.data.card,
      onProgress: (done) => {
        if (done - last < 0.02) return;
        last = done;
        reply({ type: "progress", done });
      },
    });
    reply({ type: "done", pcm }, [pcm.samples.buffer, ...(pcm.right ? [pcm.right.buffer] : [])]);
  } catch (error) {
    reply({ type: "error", message: (error as Error).message });
  }
});
