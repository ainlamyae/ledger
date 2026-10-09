"""Writes sitemap.xml: the home page plus every block, button and view address.

Those are the folders holding an index.html stub (health/physique/log/, …). A
row's Edit address (health/nutrition/<name>/) is left out: it would publish the
sheet's own data. Run after adding or removing a stub: python scripts/build_sitemap.py
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://ainlamyae.github.io/ledger/'
SECTIONS = ('health', 'finance', 'track', 'other')


def addresses():
    found = []
    for section in SECTIONS:
        for folder, _, files in os.walk(os.path.join(ROOT, section)):
            if 'index.html' in files:
                found.append(os.path.relpath(folder, ROOT).replace(os.sep, '/') + '/')
    # Section order as in the nav, then the folder tree within each.
    return [''] + sorted(found, key=lambda path: (SECTIONS.index(path.split('/')[0]), path))


def entry(path):
    depth = path.count('/')
    priority = {0: '1.0', 1: '0.8', 2: '0.6'}.get(depth, '0.4')
    return (f'  <url>\n    <loc>{SITE}{path}</loc>\n'
            f'    <changefreq>monthly</changefreq>\n    <priority>{priority}</priority>\n  </url>\n')


if __name__ == '__main__':
    body = ''.join(entry(path) for path in addresses())
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + '</urlset>\n')
    with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(xml)
    print(f'{body.count("<url>")} addresses')
