#!/usr/bin/env python3
"""
Work out, for somewhere you want to make into a planet: where its centre is, how big a square
fits, which USGS tiles to download, and what to pass dem2swg.py and the planet entry.

Give it the box you drew in the downloader:

    python3 demplan.py --box=-110.184712,37.0,-110.0,37.147428

Note the "=". A western longitude starts with a minus, and argparse reads a leading minus as
the start of another option unless the value is attached with an equals sign.

or a place and how much ground you want:

    python3 demplan.py --centre=36.0544,-112.1401 --extent 32768

Nothing is downloaded or read; this is only arithmetic, and it never needs the venv.

The thing worth internalising: the box you draw and --extent are different. Draw generously,
then --extent decides what is actually used. A box only has to CONTAIN the square you want.
"""
import argparse
import math
import os
import re

# USGS 3DEP standard products. Degrees a pixel, and what the data is worth on the ground.
PRODUCTS = {
    '1 arc-second': 1 / 3600,
    '1/3 arc-second': 1 / 3600 / 3,
    '1/9 arc-second': 1 / 3600 / 9,
    '1 metre': None,  # projected, metres already; handled separately
}


def metres_per_degree(lat):
    """North-south and east-west metres in a degree here (WGS84 series)."""
    r = math.radians(lat)
    ns = 111132.92 - 559.82 * math.cos(2 * r) + 1.175 * math.cos(4 * r) - 0.0023 * math.cos(6 * r)
    ew = 111412.84 * math.cos(r) - 93.5 * math.cos(3 * r) + 0.118 * math.cos(5 * r)
    return ns, ew


TILE_RE = re.compile(r'([ns])(\d{2})([we])(\d{3})', re.I)


def tiles_cover(names):
    """
    What a pile of tiles covers, read from their names. USGS names a one-degree tile for its
    north-west corner, so n48w123 covers 47..48 N and -123..-122 E. Filenames work as well as bare
    names, so a shell glob can be passed straight in.

    Read from the names rather than the files, so this needs no rasterio and no venv. If rasterio
    happens to be about it is used instead, because a file's own bounds beat a guess from its name.
    """
    boxes = []
    for raw in names:
        try:
            import rasterio
            with rasterio.open(raw) as src:
                b = src.bounds
                boxes.append((b.left, b.bottom, b.right, b.top, os.path.basename(raw)))
                continue
        except Exception:
            pass
        m = TILE_RE.search(os.path.basename(raw))
        if not m:
            print(f'  ? {raw}: no nNNwNNN in the name and it could not be opened, skipped')
            continue
        ns, la, we, lo = m.group(1).lower(), int(m.group(2)), m.group(3).lower(), int(m.group(4))
        north = la if ns == 'n' else -la          # the name is the NORTH-WEST corner
        west = -lo if we == 'w' else lo
        boxes.append((west, north - 1, west + 1, north, os.path.basename(raw)))
    return boxes


def tile_name(lat, lon):
    """USGS names a one-degree tile for its north-west corner: n38w111 covers 37..38 N, -111..-110."""
    return f'n{math.ceil(lat)}w{abs(math.floor(lon)):03d}'


def tiles_for(clat, clon, extent_m):
    """Every one-degree tile the square touches, not only the ones its corners land in."""
    ns, ew = metres_per_degree(clat)
    dlat, dlon = extent_m / 2 / ns, extent_m / 2 / ew
    south, north = clat - dlat, clat + dlat
    west, east = clon - dlon, clon + dlon
    out = []
    la = math.floor(south)
    while la <= math.floor(north):
        lo = math.floor(west)
        while lo <= math.floor(east):
            out.append(tile_name(la + 0.5, lo + 0.5))
            lo += 1
        la += 1
    return sorted(set(out)), (west, south, east, north)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--box', help='W,S,E,N in degrees, as the downloader reports it')
    p.add_argument('--tiles', nargs='+', help='the files you downloaded: reports what they cover')
    p.add_argument('--centre', help='LAT,LON')
    p.add_argument('--extent', type=float, help='metres a side you want the planet to be')
    p.add_argument('--product', default='1/3 arc-second', choices=list(PRODUCTS),
                   help='what you can actually download for this place')
    args = p.parse_args()

    if args.tiles:
        boxes = tiles_cover(args.tiles)
        if not boxes:
            raise SystemExit('none of those looked like tiles')
        w = min(b[0] for b in boxes); s = min(b[1] for b in boxes)
        e = max(b[2] for b in boxes); n = max(b[3] for b in boxes)
        print(f'{len(boxes)} tile(s):')
        for b in sorted(boxes, key=lambda b: (-b[3], b[0])):
            print(f'  {b[4]:<34} {b[1]:.4f}..{b[3]:.4f} N  {b[0]:.4f}..{b[2]:.4f} E')
        clat, clon = (s + n) / 2, (w + e) / 2
        m_ns, m_ew = metres_per_degree(clat)
        ns_m, ew_m = (n - s) * m_ns, (e - w) * m_ew
        gaps = round((n - s) * (e - w)) - len(boxes)
        print(f'\ntogether    {w:.4f}..{e:.4f} E, {s:.4f}..{n:.4f} N')
        print(f'            {ew_m / 1000:,.0f} km east-west by {ns_m / 1000:,.0f} km north-south')
        if gaps > 0:
            print(f'            !! that rectangle holds {round((n - s) * (e - w))} one-degree tiles and you have '
                  f'{len(boxes)}: {gaps} missing, so a window over them would find voids')
        print(f'middle      {clat:.6f},{clon:.6f}   <- the geometric middle, not necessarily where you want the map')
        print(f'largest square inside: {min(ns_m, ew_m):,.0f} m')
        if not args.extent:
            print('\nnow pick where the map should actually be centred and pass it back:')
            print(f'  demplan.py --centre={clat:.4f},{clon:.4f} --extent 32768')
            return
        extent = args.extent
    elif args.box:
        w, s, e, n = (float(v) for v in args.box.split(','))
        clat, clon = (s + n) / 2, (w + e) / 2
        m_ns, m_ew = metres_per_degree(clat)
        ns_m, ew_m = (n - s) * m_ns, (e - w) * m_ew
        fits = min(ns_m, ew_m)
        print(f'box        {w:.6f},{s:.6f} to {e:.6f},{n:.6f}')
        print(f'centre     {clat:.6f},{clon:.6f}')
        print(f'covers     {ew_m:,.0f} m east-west by {ns_m:,.0f} m north-south')
        print(f'largest square inside it: {fits:,.0f} m')
        # Stay a little inside: a window flush to the edge finds voids rather than data.
        extent = args.extent or math.floor(fits * 0.995 / 16) * 16
        if args.extent and args.extent > fits:
            print(f'\n!! --extent {args.extent:,.0f} is larger than the box. The window would reach past')
            print(f'   your data and fill with voids. Use {extent:,.0f} or draw a bigger box.')
    elif args.centre and args.extent:
        clat, clon = (float(v) for v in args.centre.split(','))
        extent = args.extent
        m_ns, m_ew = metres_per_degree(clat)
        print(f'centre     {clat:.6f},{clon:.6f}')
        print(f'draw a box at least {extent / m_ew:.6f} deg wide by {extent / m_ns:.6f} deg tall')
        print(f'  that is roughly {clon - extent / 2 / m_ew:.6f},{clat - extent / 2 / m_ns:.6f}'
              f' to {clon + extent / 2 / m_ew:.6f},{clat + extent / 2 / m_ns:.6f}')
    else:
        raise SystemExit('give --box W,S,E,N, or --centre LAT,LON with --extent METRES')

    tiles, (west, south, east, north) = tiles_for(clat, clon, extent)
    print(f'\nextent     {extent:,.0f} m a side')
    print(f'reaches    {west:.5f} to {east:.5f} E, {south:.5f} to {north:.5f} N')
    print(f'tiles      {len(tiles)} to download: {" ".join(tiles)}')
    if len(tiles) > 1:
        print('           (pass them all to --in; only the overlapping window of each is read)')

    deg = PRODUCTS[args.product]
    m_ns, m_ew = metres_per_degree(clat)
    if deg is None:
        src_ew = src_ns = 1.0
    else:
        src_ew, src_ns = deg * m_ew, deg * m_ns
    print(f'\nsource     {args.product}: {src_ew:.2f} m east-west, {src_ns:.2f} m north-south a pixel')

    # Below the source's own spacing nothing is gained; above it, file size falls as the square.
    floor_m = max(src_ew, src_ns)
    print(f'\n{"--base-metres":>14} {"samples":>9} {"MB (16-bit)":>12}  note')
    seen = set()
    for bm in sorted({4, 8, 16, 32, 64, round(floor_m), round(floor_m * 2), round(floor_m * 4)}):
        if bm < 1 or bm in seen:
            continue
        seen.add(bm)
        n_s = round(extent / bm)
        if n_s < 64 or n_s > 8192:
            continue
        note = 'finer than the source: interpolating nothing' if bm < floor_m * 0.95 else ''
        if abs(bm - floor_m) < floor_m * 0.3:
            note = 'matches the source'
        print(f'{bm:>14} {n_s:>9} {n_s * n_s * 2 / 1048576:>12.1f}  {note}')

    pick = max(4, int(round(floor_m)))
    print(f'\n--- what to run ---')
    print(f'dem2swg.py --in {" ".join(t + ".tif" for t in tiles)} \\')
    print(f'    --centre {clat:.6f},{clon:.6f} --extent {extent:.0f} --base-metres {pick} --out out/')
    print(f'\n--- then in planets.ts ---')
    print(f"dem: {{ url: '/dem/NAME', size: {extent:.0f}, lift: <-minHeight from base.json>, feather: 0, detail: 0.45 }},")
    print('\nsize must equal --extent exactly. lift comes from the run:')
    print("  python3 -c \"import json;b=json.load(open('out/base.json'))['base'];print(-b['minHeight'])\"")


if __name__ == '__main__':
    main()
