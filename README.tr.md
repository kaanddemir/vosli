# Vosli

<div align="center">
  <img src="public/icons/icon-512.png" alt="Vosli tilki simgesi" width="160" />

**Kelime öğrenme uygulaması.**

[English](README.md) · Türkçe
</div>

## Vosli Nedir?

Vosli bir kelime öğrenme uygulamasıdır. Kelimeleri kendi anlamlarınla ekler ya da bir dosyadan içe aktarırsın, sonra pratik ve aralıklı tekrarla çalışırsın. Tarayıcıda çalışır; sunucu, hesap veya ücretli servis gerektirmez.

Ayarlar’da birbirinden bağımsız iki seçim vardır:

- **Öğrenilen dil:** Almanca veya İngilizce. Her biri kendi kelimeleri, koleksiyonları ve ilerlemesiyle ayrı bir çalışma alanıdır.
- **Arayüz dili:** İngilizce (varsayılan), Türkçe veya Almanca. Yalnızca uygulamanın metinlerini değiştirir; kelimelere ve ilerlemeye dokunmaz.

## Neler Yapabilir?

- Kelime ekler, düzenler, arar, favorilere alır ve koleksiyonlarda düzenler.
- Yapıştırılan metin, CSV ve metin katmanlı PDF dosyalarını önizlemeyle içe aktarır.
- Serbest Pratik sunar: yazarak, dinleyerek, kartlarla veya kendi kelimelerinden oluşan çoktan seçmeli testle. Tekrar takvimini hiç değiştirmez.
- Akıllı Tekrar'da FSRS-6 ile tekrar planlar.
- Almancada çevrimdışı sözlükle yazımı ve artikelleri denetler, artikel (der, die, das) çalıştırır. İngilizce kelimeler denetlenmez.
- Telaffuzu gerçek insan kayıtlarıyla dinletir: Almanca ile Amerikan veya İngiliz İngilizcesi.
- İki dili de tek bir JSON dosyasına yedekler (eski, yalnızca Almanca yedekler de geri yüklenir) ve kurulabilir bir PWA olarak çevrimdışı çalışır.

## Nasıl Çalışır?

1. Kelimeleri elle girer veya bir dosyadan içe aktarırsın.
2. İçe aktarılan satırlar kaydedilmeden önce gözden geçirilir; Almancada sözlük yalnızca uyarır ve öneri sunar.
3. Kelimeler Serbest Pratik veya Akıllı Tekrar ile çalışılır.
4. Akıllı Tekrar her kelimenin kelime-anlam ve anlam-kelime becerilerini, Almancada artikeli de ayrı planlar.
5. Veriler cihazda, IndexedDB'de kalır.

## Kullanılan Teknolojiler

- **Ön yüz:** Preact, TypeScript, Vite
- **Veri:** IndexedDB, Dexie
- **Tekrar planlama:** ts-fsrs (FSRS-6)
- **PDF okuma:** PDF.js
- **Çevrimdışı:** vite-plugin-pwa
- **Testler:** Vitest, Playwright, axe

## Kurulum

Gereksinimler:

- Node.js 24 (`.nvmrc`)

Bağımlılıkları kurun ve uygulamayı başlatın:

```bash
npm ci
npm run dev
```

Temel kontroller:

```bash
npm run typecheck && npm test && npm run build
```

Tarayıcı testleri için önce `npx playwright install`, ardından `npm run test:e2e` çalıştırın. Üretim çıktısı `dist` klasörüne yazılır ve herhangi bir statik sunucuda çalışır.

## Proje Yapısı

```text
vosli/
├── src/
│   ├── core/            # depolamadan bağımsız mantık ve FSRS
│   ├── data/            # veritabanı, işlemler ve yedekleme
│   ├── audio/           # telaffuz kayıtları ve oynatma
│   ├── ui/              # ekranlar ve bileşenler
│   └── styles/          # tasarım değişkenleri ve stiller
├── public/
│   ├── dictionary/de/   # Almanca sözlük (yazım ve artikel kontrolü)
│   └── pronunciation/   # dile göre telaffuz listeleri ve künyeler (de/, en/)
├── scripts/             # sözlük ve telaffuz verisi araçları
├── tests/               # birim testleri
└── e2e/                 # tarayıcı testleri
```

## Veri Kaynakları

- **Sözlük ve telaffuz listeleri:** [Kaikki.org](https://kaikki.org/dewiktionary/rawdata.html) üzerinden Almanca Vikisözlük'ün 1 Kasım 2026 tarihli dökümünden üretilir.
- **Kayıtlar:** Almanca Vikisözlük'ün Almanca ve İngilizce maddelerine bağlı [Wikimedia Commons](https://commons.wikimedia.org/) dosyalarıdır. İngilizce kayıtlar yalnızca Commons onları Amerikan veya İngiliz İngilizcesi olarak sınıflandırıyorsa kullanılır.
- **Gizlilik:** kayıtlar uygulamayla gelmez ve saklanmaz. Her biri hoparlöre dokunduğunda Commons'tan yüklenir; bu yüzden telaffuz internet gerektirir ve Wikimedia dinlenen kelimeyi görebilir.

Güncelleme adımları [scripts/build-dictionary.mjs](scripts/build-dictionary.mjs), [scripts/sync-commons-audio.mjs](scripts/sync-commons-audio.mjs) (İngilizce için `--language en`) ve [scripts/build-english-audio.mjs](scripts/build-english-audio.mjs) dosyalarının başında anlatılır.

## Lisans

Sözlük ve telaffuz listesi verileri [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) lisanslıdır; ayrıntılar [public/dictionary/de/LICENSE.txt](public/dictionary/de/LICENSE.txt), [public/pronunciation/de/LICENSE.txt](public/pronunciation/de/LICENSE.txt) ve [public/pronunciation/en/LICENSE.txt](public/pronunciation/en/LICENSE.txt) dosyalarındadır. Telaffuz kayıtlarının lisansı kayda göre değişir ve her kelimenin sayfasında gösterilir.

<div align="center">
  <p><a href="https://heykaan.dev">heykaan.dev</a> tarafından geliştirildi.</p>
</div>
