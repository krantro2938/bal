import { toast } from "sonner";

/** Native share sheet on phones, clipboard + toast elsewhere, a prompt as the last resort. */
export async function shareLink(url: string, title: string | undefined, copied = "Ссылка скопирована") {
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast(copied);
  } catch (e) {
    if ((e as Error).name !== "AbortError") window.prompt("Ссылка:", url);
  }
}
