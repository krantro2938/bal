import { PixelSky } from "@/components/PixelSky";

/** Dev-only: the 1200×630 link-preview card, screenshotted into public/og.png. */
export function OgCard() {
  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-[#05091a]" style={{ width: 1200, height: 630 }}>
      <PixelSky className="absolute inset-0 size-full" pixel={4} still />
      <div className="absolute inset-0 bg-gradient-to-l from-[#05091a]/85 via-[#05091a]/35 to-transparent" />
      <div className="absolute inset-y-0 right-0 flex w-[640px] flex-col justify-center pr-20 text-[#ece6d6]">
        <p className="text-[22px] tracking-[0.18em] text-[#e8ddc2]/80 uppercase">Репетиции бала</p>
        <h1 className="mt-4 font-display text-[92px] leading-[0.95] font-semibold italic">Звёздная одиссея</h1>
        <p className="mt-7 max-w-[30ch] text-[26px] leading-snug text-[#ece6d6]/80">
          Видео, схемы и музыка всех танцев
          <br />
          14-го Традиционного бала РТУ&nbsp;МИРЭА
        </p>
        <p className="mt-8 text-[22px] font-medium text-[#e8ddc2]">bal.aansl.com</p>
      </div>
    </div>
  );
}
