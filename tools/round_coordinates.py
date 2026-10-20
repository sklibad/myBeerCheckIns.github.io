"""Round GeoJSON coordinates in the map data files to make them smaller.

Only numbers inside "coordinates": [...] arrays are touched; properties
(e.g. cart_check, cart_brew used for the cartogram colours) stay exact.
5 decimal places is roughly 1 m, far more than the maps need.

Usage (from the repository root, after regenerating the data files):
    python tools/round_coordinates.py map1.js map2.js map3.js data.js
"""
import re
import sys

DECIMALS = 5
NUMBER = re.compile(r'-?\d+\.\d+(?:[eE]-?\d+)?')


def round_number(match):
    value = round(float(match.group(0)), DECIMALS)
    text = f'{value:.{DECIMALS}f}'.rstrip('0').rstrip('.')
    return '0' if text == '-0' else text


def round_coordinates(text):
    out = []
    pos = 0
    for start in (m.end() for m in re.finditer(r'"coordinates"\s*:\s*', text)):
        if start < pos:
            continue
        # find the matching closing bracket of the coordinates array
        depth = 0
        end = start
        for end in range(start, len(text)):
            ch = text[end]
            if ch == '[':
                depth += 1
            elif ch == ']':
                depth -= 1
                if depth == 0:
                    break
        array = text[start:end + 1]
        array = NUMBER.sub(round_number, array)
        array = re.sub(r'\s+', '', array)
        out.append(text[pos:start])
        out.append(array)
        pos = end + 1
    out.append(text[pos:])
    return ''.join(out)


def main(paths):
    for path in paths:
        with open(path, encoding='utf-8', newline='') as f:
            text = f.read()
        rounded = round_coordinates(text)
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(rounded)
        print(f'{path}: {len(text.encode()):,} -> {len(rounded.encode()):,} bytes')


if __name__ == '__main__':
    main(sys.argv[1:])
