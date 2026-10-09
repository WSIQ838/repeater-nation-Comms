// Small icons for channel tiles (24x24, drawn with the tile's text colour).
export const ICONS = {
  none: { label: "None", d: "" },
  bolt: { label: "Bolt", d: "M13 2 4 14h6l-1 8 9-12h-6z" },
  shield: { label: "Police", d: "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" },
  flame: { label: "Fire", d: "M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-1-.5-2-1-3 3 2 5 4.5 5 7a7 7 0 0 1-14 0c0-5 4-7 7-13z" },
  cross: { label: "Medical", d: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" },
  car: { label: "Vehicle", d: "M5 11l1.6-4.5A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.5L19 11a2 2 0 0 1 2 2v4h-2v2h-3v-2H8v2H5v-2H3v-4a2 2 0 0 1 2-2zm2.2 0h9.6l-1-3H8.2zM6.5 14a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm11 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z" },
  tower: { label: "Tower", d: "M11 9h2l4 13h-2.2l-.8-3h-4l-.8 3H7zM12 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
  radio: { label: "Radio", d: "M4 8h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zm0-2L19 3l.6 1.8L7 8zM9 12a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm7 1h3v2h-3z" },
  star: { label: "Star", d: "M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.5 5.7 21.1l1.5-7L2 9.3l7-.8z" },
  alert: { label: "Alert", d: "M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z" },
  pin: { label: "Location", d: "M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" },
  users: { label: "Group", d: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.5 3-6 7-6s7 2.5 7 6zm14-5c3 0 6 1.7 6 5h-5c0-2-.8-3.7-2-5z" },
  wrench: { label: "Service", d: "M22 6.5 18.5 10l-3-.5-.5-3L18.5 3a5.5 5.5 0 0 0-7 7L3 18.5 5.5 21l8.5-8.5a5.5 5.5 0 0 0 8-6z" },
};
export const ICON_IDS = Object.keys(ICONS);

export function Icon({ id, size = 14 }) {
  const d = ICONS[id]?.d;
  if (!d) return null;
  return <svg className="chicon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d={d} fill="currentColor" fillRule="evenodd" /></svg>;
}
