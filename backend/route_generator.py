import random
import math
import xml.etree.ElementTree as ET
from typing import List, Dict
import networkx as nx
import osmnx as ox
from geopy.distance import geodesic


class RouteGenerator:
    def __init__(self):
        self.cache = {}

    def generate_route(self, lat: float, lng: float, distance_km: float) -> Dict:
        cache_key = f"{lat:.4f}_{lng:.4f}_{distance_km}"
        if cache_key in self.cache:
            routes = self.cache[cache_key]
        else:
            routes = self._build_routes_graph(lat, lng, distance_km)
            self.cache[cache_key] = routes

        route_points = self._generate_loop(routes, distance_km)
        actual_distance = self._calculate_distance(route_points)
        duration_min = (actual_distance / 8) * 60
        gpx = self._create_gpx(route_points, f"Run {distance_km}km")

        return {
            "points": [{"lat": p[0], "lng": p[1]} for p in route_points],
            "distance_km": round(actual_distance, 2),
            "duration_min": round(duration_min, 1),
            "gpx": gpx
        }

    def _build_routes_graph(self, lat: float, lng: float, distance_km: float) -> nx.MultiDiGraph:
        try:
            center = (lat, lng)
            radius = distance_km * 1000 * 0.6
            G = ox.graph_from_point(center, dist=radius, network_type="walk")
            return G
        except Exception:
            return self._create_simple_graph(lat, lng, distance_km)

    def _create_simple_graph(self, lat: float, lng: float, distance_km: float) -> nx.MultiDiGraph:
        G = nx.MultiDiGraph()
        num_points = max(int(distance_km * 20), 40)
        radius_deg = distance_km / 111.0

        for i in range(num_points):
            angle = (2 * math.pi * i) / num_points
            r = radius_deg * (0.5 + 0.5 * random.random())
            point_lat = lat + r * math.cos(angle)
            point_lng = lng + r * math.sin(angle) / math.cos(math.radians(lat))
            G.add_node(i, x=point_lng, y=point_lat)

        for i in range(num_points):
            for j in range(i + 1, min(i + 5, num_points)):
                dist = geodesic(
                    (G.nodes[i]["y"], G.nodes[i]["x"]),
                    (G.nodes[j]["y"], G.nodes[j]["x"])
                ).meters
                if dist < distance_km * 1000 * 0.3:
                    G.add_edge(i, j, length=dist)
                    G.add_edge(j, i, length=dist)

        return G

    def _generate_loop(self, G: nx.MultiDiGraph, target_km: float) -> List[tuple]:
        nodes = list(G.nodes())
        if not nodes:
            return []

        start = nodes[0]
        visited = {start}
        path = [start]
        current = start
        total_dist = 0
        target_meters = target_km * 1000

        while total_dist < target_meters * 0.85:
            neighbors = [n for n in G.neighbors(current) if n not in visited]
            if not neighbors:
                neighbors = list(G.neighbors(current))
                if not neighbors:
                    break

            next_node = random.choice(neighbors)
            edge_data = G.get_edge_data(current, next_node)
            if edge_data:
                edge_key = list(edge_data.keys())[0]
                edge_length = edge_data[edge_key].get("length", 100)
            else:
                edge_length = 100

            total_dist += edge_length
            visited.add(next_node)
            path.append(next_node)
            current = next_node

        if start in G.neighbors(current):
            path.append(start)
        else:
            path = self._close_path(G, path, start)

        return [(G.nodes[n]["y"], G.nodes[n]["x"]) for n in path]

    def _close_path(self, G: nx.MultiDiGraph, path: List[int], target: int) -> List[int]:
        try:
            shortest = nx.shortest_path(G, path[-1], target)
            return path + shortest[1:]
        except nx.NetworkXNoPath:
            path.append(path[0])
            return path

    def _calculate_distance(self, points: List[tuple]) -> float:
        total = 0
        for i in range(len(points) - 1):
            total += geodesic(points[i], points[i + 1]).km
        return total

    def _create_gpx(self, points: List[tuple], name: str) -> str:
        gpx = ET.Element("gpx", version="1.1", creator="RunRouteBot")
        trk = ET.SubElement(gpx, "trk")
        name_elem = ET.SubElement(trk, "name")
        name_elem.text = name
        trkseg = ET.SubElement(trk, "trkseg")

        for lat, lng in points:
            trkpt = ET.SubElement(trkseg, "trkpt", lat=str(lat), lon=str(lng))
            ET.SubElement(trkpt, "ele").text = "0"

        return ET.tostring(gpx, encoding="unicode", xml_declaration=True)
