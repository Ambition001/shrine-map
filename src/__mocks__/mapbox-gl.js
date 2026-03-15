const mapboxgl = {
  Map: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    remove: jest.fn(),
    resize: jest.fn(),
    flyTo: jest.fn(),
    addSource: jest.fn(),
    addLayer: jest.fn(),
    getSource: jest.fn(),
    getLayer: jest.fn(),
    setLayoutProperty: jest.fn(),
    setPaintProperty: jest.fn(),
    setFilter: jest.fn(),
  })),
  Marker: jest.fn(() => ({
    setLngLat: jest.fn().mockReturnThis(),
    addTo: jest.fn().mockReturnThis(),
    remove: jest.fn(),
  })),
  Popup: jest.fn(() => ({
    setLngLat: jest.fn().mockReturnThis(),
    setHTML: jest.fn().mockReturnThis(),
    addTo: jest.fn().mockReturnThis(),
    remove: jest.fn(),
  })),
  NavigationControl: jest.fn(),
  accessToken: '',
};

export default mapboxgl;
