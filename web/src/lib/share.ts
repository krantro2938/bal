import { toast } from "sonner";
import { track } from "./analytics";

/** Native share sheet on phones, clipboard + toast elsewhere, a prompt as the last resort. */
export async function shareLink(url: string, title: string | undefined, copied = "Ссылка скопирована") {
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title, url });
      track("share");
      return;
    }
    await navigator.clipboard.writeText(url);
    track("share");
    toast(copied);
  } catch (e) {
    if ((e as Error).name !== "AbortError") window.prompt("Ссылка:", url);
  }
}
