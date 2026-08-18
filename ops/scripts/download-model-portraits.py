#!/usr/bin/env python3
"""Download official product images into plugin static/models for offline use."""
from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "assets/examples/plugin-card-model-portrait"
OUT = PLUGIN / "static" / "models"
UA = "Mozilla/5.0 (compatible; hanye-card-model-portrait/1.3; offline-pack)"

# label -> {brand, model keys, page urls, optional direct image urls}
JOBS = [
    {
        "id": "bambu-p1s",
        "brand": "bambu",
        "models": ["P1S", "p1s", "P1-S"],
        "pages": [
            "https://store.bambulab.com/products/p1s",
            "https://store.bambulab.com/products/p1s-combo",
        ],
        "needles": ["p1s"],
    },
    {
        "id": "bambu-p1p",
        "brand": "bambu",
        "models": ["P1P", "p1p"],
        "pages": [
            "https://store.bambulab.com/products/p1p",
            "https://store.bambulab.com/search?q=P1P",
        ],
        "needles": ["p1p"],
    },
    {
        "id": "bambu-a1",
        "brand": "bambu",
        "models": ["A1", "a1"],
        "pages": [
            "https://store.bambulab.com/products/a1",
            "https://store.bambulab.com/products/bambu-lab-a1",
        ],
        "needles": ["a1"],
        # avoid matching a1mini
        "exclude": ["a1mini", "a1_mini", "a1-mini"],
    },
    {
        "id": "bambu-a1-mini",
        "brand": "bambu",
        "models": ["A1 mini", "A1 Mini", "a1mini", "A1-mini"],
        "pages": [
            "https://store.bambulab.com/products/a1-mini",
            "https://store.bambulab.com/search?q=A1%20mini",
        ],
        "needles": ["a1mini", "a1_mini"],
    },
    {
        "id": "bambu-x1c",
        "brand": "bambu",
        "models": ["X1C", "X1 Carbon", "x1-carbon", "X1-Carbon"],
        "pages": [
            "https://store.bambulab.com/products/x1-carbon",
            "https://store.bambulab.com/search?q=X1%20Carbon",
        ],
        "needles": ["x1c", "x1carbon"],
    },
    {
        "id": "bambu-x1e",
        "brand": "bambu",
        "models": ["X1E", "x1e"],
        "pages": ["https://store.bambulab.com/search?q=X1E"],
        "needles": ["x1e"],
    },
    {
        "id": "bambu-p2s",
        "brand": "bambu",
        "models": ["P2S", "p2s"],
        "pages": ["https://store.bambulab.com/search?q=P2S"],
        "needles": ["p2s"],
    },
    {
        "id": "creality-k1",
        "brand": "creality",
        "models": ["K1", "k1"],
        "pages": [
            "https://www.creality.cn/products/k1",
            "https://www.creality.cn/search?keyword=K1",
            "https://www.creality.cn/all-products",
        ],
        "needles": ["k1"],
        "exclude": ["k1max", "k1c", "k1-max"],
        "hosts": ["creality"],
    },
    {
        "id": "creality-k1-max",
        "brand": "creality",
        "models": ["K1 Max", "K1Max", "k1-max"],
        "pages": [
            "https://www.creality.cn/products/k1-max",
            "https://www.creality.cn/search?keyword=K1%20Max",
        ],
        "needles": ["k1max", "k1-max"],
        "hosts": ["creality"],
    },
    {
        "id": "creality-k1c",
        "brand": "creality",
        "models": ["K1C", "k1c"],
        "pages": [
            "https://www.creality.cn/products/k1c",
            "https://www.creality.cn/search?keyword=K1C",
        ],
        "needles": ["k1c"],
        "hosts": ["creality"],
    },
    {
        "id": "creality-ender-3-v3",
        "brand": "creality",
        "models": ["Ender-3 V3", "Ender 3 V3", "ender3v3"],
        "pages": [
            "https://www.creality.cn/products/ender-3-v3",
            "https://www.creality.cn/search?keyword=Ender-3%20V3",
        ],
        "needles": ["ender3v3", "ender-3-v3"],
        "hosts": ["creality"],
    },
    {
        "id": "creality-k2",
        "brand": "creality",
        "models": ["K2", "k2"],
        "pages": [
            "https://www.creality.cn/products/k2-series",
            "https://www.creality.cn/search?keyword=K2",
        ],
        "needles": ["k2"],
        "hosts": ["creality"],
    },
    {
        "id": "elegoo-neptune-4",
        "brand": "elegoo",
        "models": ["Neptune 4", "Neptune4", "neptune-4"],
        "pages": [
            "https://www.elegoo.com/search?q=Neptune%204",
            "https://www.elegoo.com/products/elegoo-neptune-4",
        ],
        "needles": ["neptune4", "neptune-4"],
        "hosts": ["elegoo", "shopify"],
    },
    {
        "id": "elegoo-mars-5",
        "brand": "elegoo",
        "models": ["Mars 5", "Mars5"],
        "pages": ["https://www.elegoo.com/search?q=Mars%205"],
        "needles": ["mars5", "mars-5"],
        "hosts": ["elegoo", "shopify"],
    },
    {
        "id": "anycubic-kobra-2",
        "brand": "anycubic",
        "models": ["Kobra 2", "Kobra2", "kobra-2"],
        "pages": [
            "https://cn.anycubic.com/products/kobra-2",
            "https://www.anycubic.com/products/kobra-2",
        ],
        "needles": ["kobra2", "kobra-2"],
        "hosts": ["anycubic", "shopify"],
    },
    {
        "id": "anycubic-kobra-3",
        "brand": "anycubic",
        "models": ["Kobra 3", "Kobra3"],
        "pages": [
            "https://cn.anycubic.com/search?q=Kobra%203",
            "https://www.anycubic.com/search?q=Kobra%203",
        ],
        "needles": ["kobra3", "kobra-3"],
        "hosts": ["anycubic", "shopify"],
    },
    {
        "id": "snapmaker-artisan",
        "brand": "snapmaker",
        "models": ["Artisan", "artisan"],
        "pages": ["https://snapmaker.com/snapmaker-artisan"],
        "needles": ["artisan"],
        "hosts": ["snapmaker", "cloudfront", "shopify"],
    },
    {
        "id": "snapmaker-j1",
        "brand": "snapmaker",
        "models": ["J1", "j1"],
        "pages": ["https://snapmaker.com/snapmaker-j1", "https://snapmaker.com/?s=J1"],
        "needles": ["j1"],
        "hosts": ["snapmaker", "cloudfront", "shopify"],
    },
    {
        "id": "flashforge-adventurer-5m",
        "brand": "flashforge",
        "models": ["Adventurer 5M", "Adventurer5M", "adventurer-5m"],
        "pages": [
            "https://www.flashforge.com/product-detail/flashforge-adventurer-5m-3d-printer"
        ],
        "needles": ["adventurer", "5m"],
        "hosts": ["flashforge", "shopify"],
    },
    {
        "id": "qidi-plus4",
        "brand": "qidi",
        "models": ["Plus4", "Plus 4", "Qidi Plus4"],
        "pages": [
            "https://www.qidi3d.com/search?q=Plus4",
            "https://qidi3d.com/search?q=Plus%204",
        ],
        "needles": ["plus4"],
        "hosts": ["qidi", "shopify"],
    },
    {
        "id": "voron-2-4",
        "brand": "voron",
        "models": ["Voron 2.4", "Voron2.4", "2.4"],
        "pages": [
            "https://www.vorondesign.com/",
            "https://www.vorondesign.com/voron2.4",
        ],
        "needles": ["voron", "2.4", "24"],
        "hosts": ["vorondesign", "github"],
    },
]

CTX = ssl.create_default_context()


def fetch(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as res:
        return res.read()


def compact(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def find_image_url(html: str, needles: list[str], hosts: list[str] | None, exclude: list[str] | None) -> str | None:
    urls = re.findall(
        r"https?://[^\"'\\s<>]+\.(?:png|jpe?g|webp)(?:\?[^\"'\\s<>]*)?",
        html,
        flags=re.I,
    )
    # also relative
    for rel in re.findall(r"(?:src|content)=[\"'](/[^\"']+\.(?:png|jpe?g|webp)[^\"']*)[\"']", html, flags=re.I):
        urls.append(rel)
    host_need = hosts or []
    excl = [compact(x) for x in (exclude or [])]
    for u in urls:
        low = u.lower()
        if any(x in low for x in ["favicon", "logo.png", "sprite", "1x1", "pixel", "/icon"]):
            continue
        c = compact(u)
        if excl and any(x in c for x in excl):
            continue
        if host_need and not any(h in low for h in host_need):
            # allow bblcdn for bambu pages even if not listed
            if "bblcdn" not in low and "shopify" not in low and "cloudfront" not in low:
                continue
        for n in needles:
            nc = compact(n)
            if nc and nc in c:
                return u
    # softer: first large product-looking image on allowed host
    for u in urls:
        low = u.lower()
        if any(x in low for x in ["favicon", "logo", "icon", "sprite"]):
            continue
        if host_need and not any(h in low for h in host_need) and "bblcdn" not in low and "shopify" not in low:
            continue
        if any(x in low for x in ["product", "compressed", "1920", "1500", "official"]):
            return u
    return None


def abs_url(page: str, maybe: str) -> str:
    if maybe.startswith("http"):
        return maybe
    from urllib.parse import urljoin

    return urljoin(page, maybe)


def download_job(job: dict) -> dict | None:
    needles = job["needles"]
    hosts = job.get("hosts")
    exclude = job.get("exclude")
    img_url = None
    page_used = None
    for page in job["pages"]:
        try:
            raw = fetch(page)
            html = raw.decode("utf-8", "ignore")
        except Exception as e:
            print(f"  page fail {page}: {e}")
            continue
        found = find_image_url(html, needles, hosts, exclude)
        if found:
            img_url = abs_url(page, found)
            page_used = page
            break
        time.sleep(0.3)
    if not img_url:
        print(f"FAIL {job['id']}: no image")
        return None
    try:
        data = fetch(img_url)
    except Exception as e:
        print(f"FAIL {job['id']} download {img_url}: {e}")
        return None
    if len(data) < 2000:
        print(f"FAIL {job['id']}: too small {len(data)}")
        return None
    ext = ".jpg"
    low = img_url.lower()
    if ".png" in low:
        ext = ".png"
    elif ".webp" in low:
        ext = ".webp"
    brand_dir = OUT / job["brand"]
    brand_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{job['id']}{ext}"
    dest = brand_dir / filename
    dest.write_bytes(data)
    rel = f"models/{job['brand']}/{filename}"
    print(f"OK {job['id']} -> {rel} ({len(data)} bytes) from {img_url[:90]}")
    return {
        "id": job["id"],
        "brand": job["brand"],
        "models": job["models"],
        "file": rel,
        "sourceUrl": img_url,
        "page": page_used,
        "bytes": len(data),
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = {"version": 1, "images": [], "byModel": {}}
    for job in JOBS:
        print("==", job["id"])
        row = download_job(job)
        if not row:
            continue
        catalog["images"].append(row)
        for m in job["models"]:
            catalog["byModel"][m.lower()] = row["file"]
            catalog["byModel"][compact(m)] = row["file"]
        # brand|model keys
        for m in job["models"]:
            catalog["byModel"][f"{job['brand']}|{m.lower()}"] = row["file"]
            catalog["byModel"][f"{job['brand']}|{compact(m)}"] = row["file"]
        time.sleep(0.4)

    catalog_path = PLUGIN / "static" / "models" / "catalog.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print("catalog", catalog_path, "count", len(catalog["images"]))


if __name__ == "__main__":
    main()
