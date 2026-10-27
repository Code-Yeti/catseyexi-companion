import hume from "../assets/portraits/hume.jpg";
import elvaan from "../assets/portraits/elvaan.jpg";
import mithra from "../assets/portraits/mithra.jpg";
import galka from "../assets/portraits/galka.jpg";

// Character art: one 5×4 sheet per race (both genders share it), cells in job id order (WAR..SCH).
// Sheet sizes differ, so each keeps its own cell aspect (cell width / height).
const SHEETS: Record<string, [string, number]> = {
  1: [hume, 460.8 / 464], 2: [hume, 460.8 / 464], 3: [elvaan, 460.8 / 464], 4: [elvaan, 460.8 / 464],
  7: [mithra, 480 / 448], 8: [galka, 460.8 / 464],
}; // ponytail: no Tarutaru sheet yet (race 5/6), they get no portrait

export default function Portrait({ race, job, size, className }: { race: string | number; job: string | number; size: number; className?: string }) {
  const sheet = SHEETS[race], i = Number(job) - 1;
  if (!sheet || !(i >= 0 && i < 20)) return null;
  return (
    <div className={className} style={{ width: size, aspectRatio: sheet[1], flex: "none", backgroundImage: `url(${sheet[0]})`, backgroundSize: "500% 400%",
      backgroundPosition: `${(i % 5) * 25}% ${Math.floor(i / 5) * (100 / 3)}%` }} />
  );
}
