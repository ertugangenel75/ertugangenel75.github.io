# ISDBM Digital — ARGEPLANO

> **From Parcel to Investment Decision. / Parselden Yatırım Kararına.**

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-2563eb?style=flat-square)](https://ertugangenel75.github.io/ertugangenel75.github.io/isdbm-app.html)
[![Klavuz](https://img.shields.io/badge/Kullanım%20Kılavuzu-v1.2-16a34a?style=flat-square)](https://ertugangenel75.github.io/ertugangenel75.github.io/isdbm-klavuz.html)
[![Versiyon](https://img.shields.io/badge/Versiyon-1.2-7c3aed?style=flat-square)]()

---

## 🚀 Canlı Demo

| Uygulama | Klavuz |
|---|---|
| [isdbm-app.html](https://ertugangenel75.github.io/ertugangenel75.github.io/isdbm-app.html) | [isdbm-klavuz.html](https://ertugangenel75.github.io/ertugangenel75.github.io/isdbm-klavuz.html) |

---

## 📋 Nedir?

ISDBM Digital, arsa ve parsel yatırım analizini otomatikleştiren bir karar destek platformudur. Haritadan çizilen parseller için:

- **ISDBM Skoru** hesaplar (6 metrik, ağırlıklı ortalama)
- **8 yatırım alternatifi** sıralar (Data Center, Lojistik, Konut, AVM…)
- **CAPEX formülü** ile gerçekçi maliyet tahmini yapar
- **OLS Regresyon** ile piyasa fiyatı tahmin eder
- **Finansman & Pro-Forma** analizi üretir (MOIC, IRR, Waterfall)
- **PDF raporu** indirir

---

## 🏗️ Mimari

```
isdbm-app.html          Ana uygulama (tek dosya, ~160KB)
isdbm-klavuz.html       Metodoloji ve kullanım kılavuzu
```

### Teknoloji Yığını

| Katman | Teknoloji |
|---|---|
| UI Framework | React 18 (CDN, Babel transpile) |
| Harita | Leaflet.js + OpenStreetMap |
| Adres arama | Nominatim API |
| Yakın çevre | Overpass API (OSM) |
| Mekansal interpolasyon | IDW 
| Regresyon | OLS — Gaussian elimination, saf JS |
| Fiyat endeksi | Endeksa Q4 2024 × TÜİK EKFE ekstrapolasyon |
| Nüfus verisi | TÜİK ADNKS 2023 |
| Finansman modeli | AssetRevitalization + Pro-Forma Investment Engine |
| Depolama | LocalStorage + JSON export/import |
| Hosting | GitHub Pages (HTTPS, ücretsiz) |

---

## 📊 ISDBM Metodolojisi

## 📦 Veri Kaynakları

| Veri | Kaynak | Güncelleme |
|---|---|---|
| Harita & adres | OpenStreetMap Nominatim | Sürekli |
| Uydu görüntüsü | Esri World Imagery | Periyodik |
| Yakın çevre (POI) | Overpass API | Anlık |
| İlçe nüfusu | TÜİK ADNKS 2023 | Yıllık |
| İlçe m² fiyatları | Endeksa Q4 2024 | Çeyreklik |
| Enflasyon katsayısı | TÜİK EKFE + TCMB tahmini | Çeyreklik |
| İnşaat birim maliyetleri | Çevre Bakanlığı 2024 × EKFE | Yıllık |
| Mekansal fiyat tahmini | IDW  | İlan bazlı |
| OLS Regresyon | PySAL/geosnap mantığı, saf JS | İlan bazlı |
| Finansman modeli | AssetRevitalization | — |
| Pro-Forma (MOIC/IRR) | Pro-Forma Investment Engine | — |

---

## 🗺️ Özellikler

### Harita & Parsel
- ✅ Haritadan köşe tıklayarak poligon çizme
- ✅ Alan otomatik hesaplama (Shoelace algoritması)
- ✅ Nominatim ile otomatik il/ilçe/mahalle doldurma
- ✅ OSM, Uydu, Topografik katman geçişi
- ✅ Overpass API ile 1.5km POI analizi

### Analiz
- ✅ 6 slider ile metrik girişi
- ✅ Qbiq proximity band metodolojisiyle otomatik metrik hesaplama
- ✅ 8 yatırım alternatifi otomatik sıralama
- ✅ TÜİK ADNKS 2023 il + ilçe nüfusu
- ✅ Endeksa × EKFE ekstrapolasyon (2024 Q4 → 2026 Q2)

### Piyasa Değeri
- ✅ Endeksa ilçe endeksi (60+ ilçe)
- ✅ IDW mekansal interpolasyon (2+ ilan)
- ✅ **OLS Regresyon** (5+ ilan → katsayılar + R² + RMSE)
- ✅ Koordinat girince Overpass otomatik ulaşım verisi
- ✅ Sahibinden/Hepsiemlak/Zingat referans ilan girişi

### Finansman
- ✅ Annüite taksit hesabı
- ✅ CAPEX formül motoru (5 değişken)
- ✅ Emsal/birim/kur manuel override
- ✅ Özkaynak vs tam kredi karşılaştırması
- ✅ MOIC, IRR (Newton-Raphson), Break-Even
- ✅ Equity Waterfall (3 katman)
- ✅ Vade + 5 yıl Pro-Forma projeksiyon tablosu

### Veri
- ✅ LocalStorage ile kalıcı depolama
- ✅ JSON dışa/içe aktarma
- ✅ PDF raporu (tüm veriler)

---

## ⚠️ Uyarılar

- Bu platform **karar destek** aracıdır, yatırım tavsiyesi değildir
- 2025–2026 EKFE değerleri **tahmindir**, gerçek TÜİK verisini takip edin
- OLS regresyon 5–20 ilan ile çalışır, **aynı ilçe ve yapı türü** için güvenilirdir
- TKGM/TKGM parsel verisi için belediye veya e-Devlet kullanın
- Deprem riski için AFAD verisi mutlaka kontrol edilmelidir

---

## 📁 Dosyalar

```
isdbm-app.html      Ana uygulama — GitHub Pages ile yayınlanır
isdbm-klavuz.html   Metodoloji kılavuzu — tüm formüller açıklamalı
README.md           Bu dosya
```

---

## 🏢 Hakkında

**EGBIM** tarafından geliştirilmiştir.  
Geliştirici: Ertuğan GENEL
Platform: ISDBM Digital v1.2  
Tarih: Eylül 2026
Tüm hakları Ertuğan GENEL e aittir.

---

*ISDBM: Integrated Site Development & Business Model*
