# Format test fixtures

All of these were made for the playground tests on 27 November 2026. None
is copied from a third party.

- `source.geojson`, `source-lines.geojson`: hand-written. The London points
  are the ones in docs/cli.md, the other line is Google's documented example
  (Encoded Polyline Algorithm Format page, CC BY 4.0), and the park is a made-up
  square with a square hole.
- `gdal-shapefile.shp.zip`: `ogr2ogr -f "ESRI Shapefile" gdal-shapefile.shp.zip
  source-lines.geojson -nln walks -lco ENCODING=UTF-8`, GDAL 3.6.3
  (osgeo/gdal:alpine-normal-3.6.3). QGIS exports shapefiles through the same
  GDAL driver.
- `gdal.gpkg`: `ogr2ogr -f GPKG gdal.gpkg source.geojson -nln walks
  -lco SPATIAL_INDEX=NO`, GDAL 3.6.3. Mixed geometry types, so the layer is
  GEOMETRY.
- `gdal.fgb`: `ogr2ogr -f FlatGeobuf gdal.fgb source.geojson -nln walks`,
  GDAL 3.6.3.
- `google-earth.kml`: hand-written in the structure Google Earth Pro saves:
  tabs, a StyleMap, a Folder, coordinates with a `,0` altitude, a Polygon and
  a `gx:Track`.
- `garmin.gpx`: hand-written in the structure of a Garmin Connect export:
  Garmin's namespaces, `<ele>`, `<time>` and heart rate extensions on each
  point, plus a route. The times and heart rates are made up.
