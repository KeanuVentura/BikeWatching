import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken =
  'pk.eyJ1Ijoia2VhbnV2ZW50dXJhIiwiYSI6ImNtaHBzbG1lZTBoZWgycnFjaWFrNGV6MmEifQ.gdQv9IoocjCBnVtd6Q9naQ';

// GLOBAL HELPER FUNCTIONS ---------------------------------------------------

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;

  return trips.filter(trip => {
    const startMin = minutesSinceMidnight(trip.started_at);
    const endMin = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startMin - timeFilter) <= 60 ||
      Math.abs(endMin - timeFilter) <= 60
    );
  });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    let id = station.short_name;

    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;

    return station;
  });
}

// MAP INITIALIZATION --------------------------------------------------------

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

map.on('load', async () => {
  // ===========================================================================
  // BIKE LANES
  // ===========================================================================

  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 4,
      'line-opacity': 0.6
    }
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 4,
      'line-opacity': 0.6
    }
  });

  // --------------------------------------------------------------------------
  // STATION DATA
  // --------------------------------------------------------------------------

  const jsonData = await d3.json(
    'https://dsc106.com/labs/lab07/data/bluebikes-stations.json'
  );

  let stations = jsonData.data.stations;

  // --------------------------------------------------------------------------
  // TRIP DATA (PARSED INTO DATES EXACTLY PER INSTRUCTIONS)
  // --------------------------------------------------------------------------

  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    }
  );

  // --------------------------------------------------------------------------
  // INITIAL TRAFFIC COMPUTATION
  // --------------------------------------------------------------------------

  stations = computeStationTraffic(stations, trips);

  // --------------------------------------------------------------------------
  // DRAW CIRCLES
  // --------------------------------------------------------------------------

  const svg = d3.select('#map').select('svg');

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 25]);

  let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  let circles = svg
    .selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1.5)
    .attr('opacity', 0.8)
    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic),
    );

  circles.append('title').text(
    d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
  );

  // --------------------------------------------------------------------------
  // POSITION UPDATING
  // --------------------------------------------------------------------------

  function updatePositions() {
    circles
      .attr('cx', (d) => map.project([+d.lon, +d.lat]).x)
      .attr('cy', (d) => map.project([+d.lon, +d.lat]).y);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);


  // --------------------------------------------------------------------------
  // TIME SLIDER ELEMENTS (INSIDE MAP.ON, PER INSTRUCTIONS)
  // --------------------------------------------------------------------------

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('time-display');
  const anyTimeLabel = document.getElementById('any-time');

  // --------------------------------------------------------------------------
  // UPDATE SCATTER PLOT
  // --------------------------------------------------------------------------

  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsbyTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles = circles
      .data(filteredStations, d => d.short_name)
      .join('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.8)
      .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );

    updatePositions();
  }

  // --------------------------------------------------------------------------
  // UPDATE TIME DISPLAY
  // --------------------------------------------------------------------------

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();

});
