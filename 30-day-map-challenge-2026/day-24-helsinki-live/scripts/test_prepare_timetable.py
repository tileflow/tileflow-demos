import io
import unittest
import zipfile

from prepare_timetable import build


class BuildTimetable(unittest.TestCase):
    def test_calendar_exceptions_dst_interleaved_times_and_coincident_departures(self):
        files = {
            "feed_info": "feed_start_date,feed_end_date\n20261024,20261027",
            "agency": "agency_timezone\nEurope/Helsinki",
            "routes": "route_id,route_type\nR,3",
            "trips": ("trip_id,route_id,direction_id,service_id\n"
                      "week,R,0,weekly\nextra,R,0,holiday\ndouble,R,0,together"),
            "calendar": ("service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                         "weekly,1,1,1,1,1,1,1,20261024,20261027"),
            "calendar_dates": ("service_id,date,exception_type\n"
                               "weekly,20261025,2\nholiday,20261025,1\ntogether,20261026,1"),
            "stop_times": ("trip_id,stop_sequence,stop_id,arrival_time,departure_time\n"
                           "week,3,Z,,\nweek,4,Y,25:04:00,25:04:00\n"
                           "extra,1,X,25:02:00,25:02:00\nextra,3,Z,,\nextra,4,Y,25:05:00,25:05:00\n"
                           "week,1,X,25:02:00,25:02:00\n"
                           "double,1,X,25:02:00,25:02:00\ndouble,3,Z,,\ndouble,4,Y,25:04:00,25:04:00"),
        }
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as output:
            for name, text in files.items():
                output.writestr(name+".txt", text)
        with zipfile.ZipFile(buffer) as archive:
            table = build(archive)
        self.assertEqual(table["starts"][1]-table["starts"][0], 25*3600)
        self.assertEqual(table["starts"][2]-table["starts"][1], 24*3600)
        groups = table["routes"]["R"]["0"][25*3600+120]
        for day, expected in enumerate([[120], [180], [120, 120], [120]]):
            active = []
            for mask, pattern, profile in groups:
                if int(table["masks"][mask],16) & (1 << day):
                    self.assertEqual(table["patterns"][pattern], [("X","Z","Y"),(1,3,4)])
                    self.assertIsNone(table["profiles"][profile][1])
                    active.append(table["profiles"][profile][2])
            self.assertEqual(active, expected)


if __name__ == "__main__":
    unittest.main()
