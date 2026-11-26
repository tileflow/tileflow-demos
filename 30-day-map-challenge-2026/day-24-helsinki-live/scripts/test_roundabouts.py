"""Regression checks for the two ways a bus crosses a divided junction. Run with Python and Shapely 2."""
import math
import unittest

from roundabouts import apply_roundabouts, geographic, local


class DirectedRoundabout(unittest.TestCase):
    def test_crossings_in_both_directions_and_a_flyover(self):
        ring = [geographic((20 * math.cos(i * math.pi / 8), 20 * math.sin(i * math.pi / 8))) for i in range(16)]
        west, east = geographic((-75, 0)), geographic((75, 0))
        gates = [[0, 0, [ring[0], east]], [8, 0, [ring[8], west]]]
        paths = {"east": [west, east], "west": [east, west], "flyover": [geographic((0, -80)), geographic((0, 80))]}
        network = {"shapes": paths.copy(), "routes": {"line": {"patterns": [
            {"shape": k, "stopOffsets": [0, 150]} for k in ["east", "west"]
        ]}}}
        measure = lambda a, b: math.dist(local(a), local(b))
        apply_roundabouts(network, [[ring, gates, [paths["flyover"]]]], measure)
        for name, mid in [("east", 12), ("west", 4)]:
            self.assertIn(ring[mid], network["shapes"][name])
            self.assertNotIn(ring[(mid + 8) % 16], network["shapes"][name])
        for pattern in network["routes"]["line"]["patterns"]:
            self.assertGreater(pattern["stopOffsets"][-1], 165)
        self.assertEqual(network["shapes"]["flyover"], paths["flyover"])
        self.assertNotIn("flyover", network["roundaboutGaps"])


if __name__ == "__main__":
    unittest.main()
