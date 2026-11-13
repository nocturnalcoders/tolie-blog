"""Download the free DB-IP "IP to Country Lite" database (CC BY 4.0, https://db-ip.com).

Run at image build time: python fetch_geoip.py geoip/country.mmdb
It never fails the build. Without the file the blog still works; visits just have no country.
"""
import gzip
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

target = Path(sys.argv[1] if len(sys.argv) > 1 else "geoip/country.mmdb")
target.parent.mkdir(parents=True, exist_ok=True)
today = date.today()
last_month = today.replace(day=1) - timedelta(days=1)
for month in (today, last_month):  # this month's file appears a few days into the month
    url = f"https://download.db-ip.com/free/dbip-country-lite-{month:%Y-%m}.mmdb.gz"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "tolie-blog/1.0"})  # the default one is refused
        with urllib.request.urlopen(req, timeout=60) as res:  # noqa: S310 (fixed https URL)
            target.write_bytes(gzip.decompress(res.read()))
        print(f"GeoIP: saved {url}")
        break
    except Exception as exc:
        print(f"GeoIP: could not get {url} ({exc})")
else:
    print("GeoIP: no database, visits will be counted without a country")
