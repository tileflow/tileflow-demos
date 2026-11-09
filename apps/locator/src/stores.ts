import { distanceKm, type Coordinate } from "@tileflow-demos/shared/geo";

export const amenities = ["Refill", "Terrace", "Step-free"] as const;
export type Amenity = typeof amenities[number];
export const nearbyRadiusKm = 50;

export interface Store {
  id: string;
  name: string;
  district: string;
  point: Coordinate;
  hours: string;
  amenities: Amenity[];
}

export const stores: Store[] = [
  { id: "azulejo", name: "Azulejo House", district: "Graça", point: [-9.1296, 38.7177], hours: "08:00–18:00", amenities: ["Refill", "Terrace"] },
  { id: "alameda", name: "Alameda Counter", district: "Arroios", point: [-9.1355, 38.7356], hours: "07:30–17:00", amenities: ["Refill", "Step-free"] },
  { id: "estufa", name: "Estufa Café", district: "Príncipe Real", point: [-9.1489, 38.7166], hours: "08:00–19:00", amenities: ["Terrace", "Step-free"] },
  { id: "oficina", name: "Oficina Roastery", district: "Santos", point: [-9.1559, 38.7078], hours: "08:30–18:00", amenities: ["Refill", "Step-free"] },
  { id: "jardim", name: "Jardim Kiosk", district: "Estrela", point: [-9.16, 38.7153], hours: "09:00–17:30", amenities: ["Terrace"] },
  { id: "mercado", name: "Linha Marmelo", district: "Campo de Ourique", point: [-9.1657, 38.7165], hours: "07:00–16:00", amenities: ["Refill"] },
];

function normalize(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function hasNearbyStore(position: Coordinate) {
  return stores.some((store) => distanceKm(position, store.point) <= nearbyRadiusKm);
}

export function findStores(query: string, amenity: Amenity | null, origin: Coordinate | null) {
  const term = normalize(query);
  const results = stores
    .filter((store) => normalize(store.name + " " + store.district).includes(term))
    .filter((store) => !amenity || store.amenities.includes(amenity))
    .map((store) => ({ store, distance: origin && distanceKm(origin, store.point) }));

  return origin ? results.sort((a, b) => a.distance! - b.distance!) : results;
}

export function storeNumber(id: string) {
  return String(stores.findIndex((store) => store.id === id) + 1).padStart(2, "0");
}
