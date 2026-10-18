#!/usr/bin/env python3
"""
Turn a real-world elevation raster into the two things swg3js needs for a planet:

  base.hmap     the collidable surface, resampled to the terrain's own tile width
  base16.raw    the same heights at 16-bit, for when HMAP is widened past 8-bit
  normal.png    a tangent-space normal map of ONLY what the mesh is too coarse to hold
  base.json     the metadata needed to turn bytes back into metres

The split matters. Anything the heightfield can represent must live in the heightfield, where
the collider sees it too; anything finer must live in the normal map, where it is honest to
fake it. Building the normal map from the raw source instead would encode the macro shape a
second time, so every slope would be lit twice and the bumps would read as terrain you cannot
stand on.

  python3 dem2swg.py --in dem.tif --map-metres 16384 --tile-metres 4 --out out/
  python3 dem2swg.py --in dem.tif --map-metres 16384 --tile-metres 8 --exaggerate 1.6

Reads GeoTIFF through rasterio when it is installed, else any raster PIL can open (16-bit TIFF
and PNG included), else a .npy array.
"""
import argparse
import json
import math
import os
import sys

import numpy as np


def metres_per_degree(lat):
    """
    Metres in a degree at this latitude, north-south and east-west. The flat 110574 and
    111320*cos is out by half a percent toward the poles, which is a scale error between the
    heights and the ground they sit on; the WGS84 series costs nothing and does not have it.
    """
    r = math.radians(lat)
    ns = 111132.92 - 559.82 * math.cos(2 * r) + 1.175 * math.cos(4 * r) - 0.0023 * math.cos(6 * r)
    ew = 111412.84 * math.cos(r) - 93.5 * math.cos(3 * r) + 0.118 * math.cos(5 * r)
    return ns, ew


def read_geographic_window(paths, clat, clon, extent_m, n_out, void_level=None):
    """
    Read a square of ground out of one or more rasters stored in degrees, and hand back a square
    grid of metres.

    Three jobs at once. A one-degree tile is 88 km across and nobody wants 88 km of planet, so it
    crops. In a geographic CRS a pixel is not square on the ground -- at 37 N a 1/3 arc-second pixel
    is 8.2 m across and 10.2 m tall -- so a grid read straight out comes back squashed by a quarter
    north to south; building a destination whose sides are equal in metres and reprojecting into it
    fixes that. And a window near a tile corner falls across several tiles, so each is read in turn
    and composited, which is also why only the overlapping part of each file is ever touched: four
    whole tiles would be about two gigabytes, and four windows are a few megabytes.
    """
    import rasterio
    from rasterio.transform import from_bounds as transform_from_bounds
    from rasterio.warp import reproject, Resampling
    from rasterio.windows import from_bounds as window_from_bounds

    if isinstance(paths, str):
        paths = [paths]

    m_lat, m_lon = metres_per_degree(clat)
    dlat = extent_m / 2 / m_lat
    dlon = extent_m / 2 / m_lon
    west, east = clon - dlon, clon + dlon
    south, north = clat - dlat, clat + dlat
    # Equal metres each way across n_out samples, so what comes out is square on the ground.
    dst_transform = transform_from_bounds(west, south, east, north, n_out, n_out)
    out = np.full((n_out, n_out), np.nan, np.float32)

    used = 0
    for path in paths:
        with rasterio.open(path) as src:
            if not (src.crs and src.crs.is_geographic):
                raise SystemExit(f'{path}: --centre is for rasters stored in degrees; this one is projected')
            b = src.bounds
            if b.right <= west or b.left >= east or b.top <= south or b.bottom >= north:
                print(f'  {path}: no overlap, skipped')
                continue
            # A pixel of margin, so neighbouring tiles meet without a seam of missing samples.
            pad = abs(src.transform.a)
            win = window_from_bounds(max(west - pad, b.left), max(south - pad, b.bottom),
                                     min(east + pad, b.right), min(north + pad, b.top), src.transform)
            a = src.read(1, window=win).astype(np.float32)
            piece = np.full((n_out, n_out), np.nan, np.float32)
            reproject(a, piece,
                      src_transform=src.window_transform(win), src_crs=src.crs,
                      dst_transform=dst_transform, dst_crs=src.crs,
                      src_nodata=src.nodata, dst_nodata=np.nan,
                      resampling=Resampling.bilinear)
            take = ~np.isnan(piece)
            out[take] = piece[take]
            used += 1
            print(f'  {path}: {a.shape[1]}x{a.shape[0]} px of it used, {take.sum() * 100 / out.size:.0f}% of the window')
    if not used:
        raise SystemExit(f'none of the {len(paths)} file(s) covers {clat}, {clon}')

    out = np.where((out < -1e4) | (out > 1e5), np.nan, out)
    voids = int(np.isnan(out).sum())
    if voids:
        share = voids * 100 / out.size
        how = f'set flat to {void_level} m' if void_level is not None else 'taken from their nearest neighbours'
        print(f'  {voids} samples ({share:.1f}%) have no data, {how}'
              + ('' if share < 1 else ' -- a tile is missing from --in, or the window reaches past them all'))
        out, _ = fill_holes(out, void_level)
    print(f'  window {n_out}x{n_out} at {extent_m / n_out:.2f} m a sample, square on the ground')
    return out


def read_raster(path):
    """
    The source heights as float32, plus what the file says about its own ground scale. The scale is
    the whole game: the heights mean nothing without knowing how much ground they are spread over,
    and a raster declared narrower than it is comes out with every slope too steep.
    """
    info = {'how': '?', 'pixel_m': None, 'crs': None, 'unit': None, 'nodata': None}
    if path.endswith('.npy'):
        info['how'] = 'npy (no georeferencing, so --map-metres is taken on trust)'
        return np.load(path).astype(np.float32), info
    try:
        import rasterio
        with rasterio.open(path) as src:
            a = src.read(1).astype(np.float32)
            info['how'] = 'rasterio'
            info['crs'] = str(src.crs)
            info['nodata'] = src.nodata
            if src.nodata is not None:
                a = np.where(a == src.nodata, np.nan, a)
            # Pixel size in the CRS's own units. Degrees mean the file is unprojected, and a degree
            # is not a length, so that has to be converted before any of this means anything.
            px = abs(src.transform.a)
            unit = None
            try:
                unit = src.crs.linear_units if src.crs else None
            except Exception:
                unit = None
            if src.crs and src.crs.is_geographic:
                info['unit'] = 'degrees'
                import math
                mid = src.bounds.bottom + (src.bounds.top - src.bounds.bottom) / 2
                info['pixel_m'] = px * metres_per_degree(mid)[1]
            else:
                info['unit'] = unit or 'metre'
                k = 0.3048006096012192 if unit and 'foot' in unit.lower() else 1.0
                info['pixel_m'] = px * k
            return a, info
    except ImportError:
        pass
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(path)
    info['how'] = f'PIL ({im.mode}), no georeferencing read'
    a = np.asarray(im).astype(np.float32)
    # Without rasterio the nodata sentinel is still in the data. USGS uses large negatives; left in,
    # they drag the minimum down and squash every real height into a fraction of the byte range.
    a = np.where((a < -1e4) | (a > 1e5), np.nan, a)
    return a, info


def fill_holes(a, level=None):
    """
    A DEM has voids -- radar shadow, and very often open water, which many surveys do not measure.
    Left as NaN they punch holes in the ground.

    Nearest neighbour is right for a void in the middle of land: a few missing samples take the
    height of what surrounds them. It is badly wrong for a bay, because the nearest real sample to
    the middle of Puget Sound is a hillside, and the sea comes out as a smeared ramp of shoreline
    heights. Give `level` and every void is set flat to it instead, which is what water is.
    """
    if not np.isnan(a).any():
        return a, 0
    holes = np.isnan(a)
    if level is not None:
        out = a.copy()
        out[holes] = level
        return out, int(holes.sum())
    from scipy import ndimage
    idx = ndimage.distance_transform_edt(holes, return_distances=False, return_indices=True)
    return a[tuple(idx)], int(holes.sum())


def box_resample(a, n):
    """
    Area mean down to n x n. Mean is the right choice for ground that is walked on: it puts the
    surface through the middle of what is there. Cubic keeps ridges sharper but overshoots, and
    an overshoot in a heightfield is a spike the character controller has to climb.
    """
    src = a.shape[0]
    if src == n:
        return a.copy()
    if src > n and src % n == 0:
        k = src // n
        return a.reshape(n, k, n, k).mean(axis=(1, 3))
    # Non-integer ratio: average over per-cell slices so it stays a true area mean.
    edges = np.linspace(0, src, n + 1).round().astype(int)
    out = np.empty((n, n), np.float32)
    for r in range(n):
        band = a[edges[r]:max(edges[r] + 1, edges[r + 1])]
        for c in range(n):
            out[r, c] = band[:, edges[c]:max(edges[c] + 1, edges[c + 1])].mean()
    return out


def bilinear_up(a, n):
    """The coarse surface back at full resolution, so the residual is source minus mesh."""
    from scipy import ndimage
    zoom = n / a.shape[0]
    return ndimage.zoom(a, zoom, order=1, grid_mode=True, mode='nearest')


def square_crop(a):
    """A planet is square; take the middle of whatever was downloaded."""
    h, w = a.shape
    s = min(h, w)
    return a[(h - s) // 2:(h - s) // 2 + s, (w - s) // 2:(w - s) // 2 + s]


def write_hmap(path, grid8):
    """HMAP: the four bytes, width and height as little-endian uint32, then the rows top-down."""
    h, w = grid8.shape
    with open(path, 'wb') as f:
        f.write(b'HMAP')
        f.write(np.uint32(w).tobytes())
        f.write(np.uint32(h).tobytes())
        f.write(grid8.astype(np.uint8).tobytes())


def normal_map(residual, metres_per_sample, strength=1.0):
    """
    The residual's gradient as a tangent-space normal. The ground's texture coordinate is world XZ,
    so the tangent is world +X and the bitangent world +Z by construction and no tangent frame is
    needed -- which is exactly the frame a top-down raster derivative is already in.
    """
    gz, gx = np.gradient(residual.astype(np.float32), metres_per_sample)
    nx, ny, nz = -gx * strength, np.ones_like(gx), -gz * strength
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    # Packed the usual way: x and z into red and green around 0.5, up in blue.
    rgb = np.stack([nx * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5, ny * inv], axis=-1)
    return (np.clip(rgb, 0, 1) * 255).round().astype(np.uint8)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--in', dest='src', required=True, nargs='+',
                   help='one raster, or several tiles to mosaic (only the window of each is read)')
    p.add_argument('--out', default='out')
    p.add_argument('--map-metres', type=float, default=16384, help="the planet's mapWidthInMeters")
    p.add_argument('--tile-metres', type=float, default=4, help="the planet's tileWidthInMeters")
    p.add_argument('--base-metres', type=float, default=0,
                   help='metres per base sample; defaults to the tile width. Larger is a smaller '
                        'file, and the fractal layers already supply detail below a tile.')
    p.add_argument('--exaggerate', type=float, default=1.0,
                   help='vertical scale. Real relief reads flat at walking pace; 1.5 to 2 is usual.')
    p.add_argument('--normal-strength', type=float, default=1.0)
    p.add_argument('--normal-samples', type=int, default=2048,
                   help='side of the normal map. It tiles over world XZ, so it does not need to '
                        'match the source: 2048 is already finer than the eye reads at ground level.')
    p.add_argument('--residual-warn', type=float, default=2.0,
                   help='metres of residual above which the normal map is faking real geometry')
    p.add_argument('--sea-level', type=float, default=None, help='metres of source elevation to put at height 0')
    p.add_argument('--centre', help='LAT,LON to cut a square around, for a raster stored in degrees')
    p.add_argument('--extent', type=float, default=4096, help='metres a side of the --centre square')
    p.add_argument('--inspect', action='store_true', help='report what the file holds and write nothing')
    p.add_argument('--feet', action='store_true', help='the heights are in feet, not metres')
    p.add_argument('--clip', action='store_true', help='hold heights to the 0.1-99.9 percentile, cutting spikes')
    p.add_argument('--void-level', type=float, default=None,
                   help='set voids flat to this height rather than to their nearest neighbour. For a '
                        'coast, pass the sea level: 0 on most surveys.')
    p.add_argument('--trust-map-metres', action='store_true', help='use --map-metres even when the file disagrees')
    args = p.parse_args()

    os.makedirs(args.out, exist_ok=True)
    geo = None
    if args.centre:
        try:
            clat, clon = (float(v) for v in args.centre.split(','))
        except ValueError:
            raise SystemExit('--centre wants LAT,LON, for example --centre 37.0340,-110.0880')
        base_m0 = args.base_metres or args.tile_metres
        n_out = max(2, int(round(args.extent / base_m0)))
        print(f'cutting {args.extent:.0f} m around {clat}, {clon} out of {len(args.src)} file(s)')
        raw = read_geographic_window(args.src, clat, clon, args.extent, n_out, args.void_level)
        args.map_metres = args.extent
        geo = {'lat': clat, 'lon': clon,
               'metresPerDegreeNorthSouth': round(metres_per_degree(clat)[0], 1),
               'metresPerDegreeEastWest': round(metres_per_degree(clat)[1], 1),
               'gameX': 'lon = centre.lon + gameX / metresPerDegreeEastWest',
               'gameZ': 'lat = centre.lat - gameZ / metresPerDegreeNorthSouth'}
        info = {'how': 'rasterio window', 'pixel_m': args.extent / n_out, 'crs': None,
                'unit': 'metre', 'nodata': None}
    else:
        if len(args.src) > 1:
            raise SystemExit('several files need --centre, which is what decides where to cut them')
        raw, info = read_raster(args.src[0])
    print(f'read {args.src[0] if len(args.src) == 1 else str(len(args.src)) + " tiles"} '
          f'via {info["how"]}: {raw.shape[1]}x{raw.shape[0]}')
    if info['crs']:
        print(f'  crs {info["crs"]}, units {info["unit"]}, nodata {info["nodata"]}')

    # What the file says it covers, against what was asked for. A mismatch here scales every slope.
    true_m = None if args.centre else (info['pixel_m'] * min(raw.shape) if info['pixel_m'] else None)
    if true_m:
        print(f'  the raster covers {true_m:.0f} m of ground ({info["pixel_m"]:.2f} m a pixel)')
        if abs(true_m - args.map_metres) / true_m > 0.02:
            if args.trust_map_metres:
                print(f'  !! --map-metres {args.map_metres:.0f} disagrees with the file. Slopes will be '
                      f'{true_m / args.map_metres:.2f}x what they are on the ground.')
            else:
                print(f'  !! --map-metres {args.map_metres:.0f} disagrees with the file; using {true_m:.0f} m. '
                      f'Pass --trust-map-metres to override, and --size {true_m:.0f} to __debug.dem.')
                args.map_metres = true_m

    lo_raw, hi_raw = float(np.nanmin(raw)), float(np.nanmax(raw))
    print(f'  elevation {lo_raw:.1f} to {hi_raw:.1f} ({hi_raw - lo_raw:.1f} span) in the file\'s own units')
    if args.feet:
        raw = raw * 0.3048006096012192
        print(f'  --feet: {lo_raw * 0.3048:.1f} to {hi_raw * 0.3048:.1f} m')
    p = np.nanpercentile(raw, [0.1, 50, 99.9])
    print(f'  percentiles 0.1 / 50 / 99.9: {p[0]:.1f} / {p[1]:.1f} / {p[2]:.1f} m')
    if (hi_raw - p[2]) > (p[2] - p[0]) * 0.25:
        print('  !! the top of the range is far above the 99.9th percentile: spikes, probably voids '
              'the nodata value did not catch. --clip trims them.')
    if args.clip:
        raw = np.clip(raw, p[0], p[2])
        print(f'  --clip: held to {p[0]:.1f}..{p[2]:.1f} m')
    if args.inspect:
        return
    raw, filled = fill_holes(raw, args.void_level)
    if filled:
        how = f'flat at {args.void_level} m' if args.void_level is not None else 'from their nearest neighbours'
        print(f'  filled {filled} void samples {how}')
    raw = square_crop(raw)
    src_n = raw.shape[0]
    src_m = args.map_metres / src_n
    print(f'  square crop {src_n}x{src_n}, {src_m:.2f} m per source sample')

    base_m = args.base_metres or args.tile_metres
    base_n = max(2, int(round(args.map_metres / base_m)))
    if base_n > src_n:
        # Upsampling invents nothing and the slow path costs base_n^2 operations: at 44207 that is
        # two billion, which looks exactly like a hang. Fall back to the source's own resolution.
        print(f'  !! a {base_n}x{base_n} base is finer than the {src_n}x{src_n} source. '
              f'Using {src_n} instead ({args.map_metres / src_n:.2f} m a sample); '
              f'--base-metres below {args.map_metres / src_n:.1f} buys nothing here.')
        base_n = src_n
    base = box_resample(raw, base_n)
    print(f'  base {base_n}x{base_n} at {args.map_metres / base_n:.2f} m per sample (area mean)')

    if args.sea_level is not None:
        base -= args.sea_level
        raw = raw - args.sea_level
    base *= args.exaggerate
    raw = raw * args.exaggerate

    lo, hi = float(base.min()), float(base.max())
    span = max(hi - lo, 1e-6)
    print(f'  relief {lo:.1f} to {hi:.1f} m ({span:.1f} m span, exaggeration {args.exaggerate}x)')

    # 8-bit is what HMAP holds today. Say plainly what that costs, because it is visible.
    step8 = span / 255
    print(f'  8-bit step {step8:.2f} m  <-- terracing on every slope until HMAP carries 16 bits')
    write_hmap(os.path.join(args.out, 'base.hmap'), np.round((base - lo) / span * 255))
    (np.round((base - lo) / span * 65535).astype('<u2')).tofile(os.path.join(args.out, 'base16.raw'))
    print(f'  16-bit step {span / 65535:.4f} m')

    # Only what the mesh cannot hold. Everything coarser is already geometry the collider sees.
    residual = raw - bilinear_up(base, src_n)
    rr = float(np.abs(residual).max())
    p95 = float(np.percentile(np.abs(residual), 95))
    print(f'  residual 95th pct {p95:.2f} m, peak {rr:.2f} m')
    if p95 > args.residual_warn:
        # A normal map only tells the truth about detail too fine to stand on. Past a metre or two
        # it is drawing cliffs and boulders the collider knows nothing about, and the ground stops
        # feeling like it looks. The fix is a finer base, not a weaker normal map.
        print(f'  !! residual is large. The normal map would be faking geometry the collider has '
              f'no idea about.\n     Use --base-metres {max(1.0, args.map_metres / base_n / 2):.0f} '
              f'or pick gentler source terrain.')

    # The normal map tiles over world XZ, so its resolution is independent of the source's.
    nn = min(args.normal_samples, src_n)
    res_small = box_resample(residual, nn) if nn != src_n else residual
    from PIL import Image
    Image.fromarray(normal_map(res_small, args.map_metres / nn, args.normal_strength)).save(
        os.path.join(args.out, 'normal.png'), optimize=True)
    print(f'  normal map {nn}x{nn} at {args.map_metres / nn:.2f} m per sample')

    meta = {
        'source': ', '.join(os.path.basename(f) for f in args.src),
        'mapWidthInMeters': args.map_metres,
        'tileWidthInMeters': args.tile_metres,
        'base': {'samples': base_n, 'metresPerSample': args.map_metres / base_n,
                 'minHeight': lo, 'maxHeight': hi,
                 'note': 'height = minHeight + byte / 255 * (maxHeight - minHeight)'},
        'normal': {'samples': nn, 'metresPerSample': args.map_metres / nn, 'residualMetres': rr,
                   'space': 'tangent; tangent is world +X, bitangent world +Z'},
        'exaggeration': args.exaggerate,
        # Where on Earth this came from, so a position in the game can be turned back into a place
        # and the other way about. Without it the only record is the command someone once typed.
        'centre': geo,
    }
    with open(os.path.join(args.out, 'base.json'), 'w') as f:
        json.dump(meta, f, indent=2)
    for n in ('base.hmap', 'base16.raw', 'normal.png', 'base.json'):
        print(f'  wrote {n} ({os.path.getsize(os.path.join(args.out, n)) / 1048576:.2f} MB)')


if __name__ == '__main__':
    sys.exit(main())
