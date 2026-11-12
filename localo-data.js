/** Load collected data relative to this module, including on GitHub Pages. */
export async function loadLocaloData() {
  const response = await fetch(new URL('./localo.json', import.meta.url));
  if (!response.ok) {
    throw new Error(`데이터를 불러오지 못했습니다 (${response.status})`);
  }
  const data = await response.json();
  if (data.schemaVersion !== 1 || !Array.isArray(data.regions) || !Array.isArray(data.places)) {
    throw new Error('지원하지 않는 데이터 형식입니다.');
  }
  return data;
}

export function getRegionData(data, regionId) {
  return {
    region: data.regions.find(region => region.id === regionId) ?? null,
    places: data.places.filter(place => place.regionId === regionId),
  };
}

