# Vosli

<div align="center">
  <img src="public/icons/icon-512.png" alt="Vosli tilki simgesi" width="160" />

**Türkçe konuşanlar için Almanca kelime çalışma uygulaması.**

[English](README.md) · Türkçe
</div>

## Vosli Nedir?

Vosli, Almanca kelimeleri eklemeyi, içe aktarmayı ve aralıklı tekrarla çalışmayı kolaylaştırır. Tamamen tarayıcıda çalışır; sunucu, hesap veya ücretli servis gerektirmez.

## Neler Yapabilir?

- Kelime ekler, düzenler, arar, favorilere alır ve koleksiyonlarda düzenler.
- Yapıştırılan metin, CSV ve metin katmanlı PDF dosyalarını önizlemeyle içe aktarır.
- Serbest Pratik'te dört yolla çalışmayı sağlar: yazarak, dinleyerek, kartlarla ve seçenekleri yalnızca kullanıcının kendi kelimelerinden gelen çoktan seçmeli test. Hiçbiri tekrar takvimini değiştirmez.
- Akıllı Tekrar'da FSRS-6 ile tekrar planlar.
- Çevrimdışı sözlükle Almanca yazımı ve artikelleri denetler.
- Kelimelerin telaffuzunu gerçek insan kayıtlarıyla dinletir.
- Tüm verileri tek bir JSON dosyasına yedekler ve kurulabilir bir PWA olarak çevrimdışı çalışır.

## Nasıl Çalışır?

1. Kullanıcı kelimeleri elle girer veya bir dosyadan içe aktarır.
2. İçe aktarılan satırlar kaydedilmeden önce gözden geçirilir; sözlük yalnızca uyarır ve öneri sunar.
3. Kelimeler Serbest Pratik veya Akıllı Tekrar ile çalışılır.
4. Akıllı Tekrar her kelimenin Almanca-Türkçe, Türkçe-Almanca ve artikel becerilerini ayrı planlar.
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
├── public/dictionary/   # çevrimdışı sözlük
├── scripts/             # sözlük ve telaffuz verisi araçları
├── tests/               # birim testleri
└── e2e/                 # tarayıcı testleri
```

## Veri Kaynakları

Çevrimdışı sözlük, [Kaikki.org](https://kaikki.org/dewiktionary/rawdata.html) üzerinden Almanca Vikisözlük'ün 1 Kasım 2026 tarihli dökümünden üretilir.

Telaffuz kayıtları, Vikisözlük maddelerine bağlı [Wikimedia Commons](https://commons.wikimedia.org/) dosyalarıdır. Uygulamayla gelmez ve saklanmaz; hoparlöre dokunulduğunda Commons'tan yüklenir. Bu yüzden telaffuz internet gerektirir ve Wikimedia dinlenen kelimeyi görebilir.

Sözlüğü ve telaffuz verisini güncelleme adımları [scripts/build-dictionary.mjs](scripts/build-dictionary.mjs) ve [scripts/sync-commons-audio.mjs](scripts/sync-commons-audio.mjs) dosyalarının başında anlatılır.

## Lisans

Sözlük verisi [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) lisanslıdır; ayrıntılar [public/dictionary/LICENSE.txt](public/dictionary/LICENSE.txt) dosyasındadır. Telaffuz kayıtlarının lisansı kayda göre değişir ve her kelimenin sayfasında gösterilir.

<div align="center">
  <p><a href="https://heykaan.dev">heykaan.dev</a> tarafından geliştirildi.</p>
</div>
