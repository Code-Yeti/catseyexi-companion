// Item icon by item id, from FFXIAH (the same source catseyexi.com's item pages use). Hidden if it fails to load.
export default function ItemIcon({ id, size = 20 }: { id: number; size?: number }) {
  return <img className="item-icon" src={`https://static.ffxiah.com/images/icon/${id}.png`} width={size} height={size} alt="" loading="lazy"
    onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />;
}
