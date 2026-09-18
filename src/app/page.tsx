"use client";

import { useState } from "react";
import {
  CATEGORY_LABELS,
  Category,
  SocialLink,
  UniversityProfile,
  VerifiedImage,
} from "@/lib/types";
import { SOCIAL_LABELS } from "@/lib/socials";

function getSourceLabel(sourcePage: string): string {
  try {
    const host = new URL(sourcePage).hostname.replace(/^www\./, "");
    if (host.includes("wikimedia")) return "Wikimedia Commons";
    return host;
  } catch {
    return "источник";
  }
}

function formatDate(date?: string): string | null {
  if (!date) return null;
  return date.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

const FILTERS: Category[] = [
  "campus",
  "dorms",
  "classrooms",
  "library",
  "sports",
  "labs",
  "student_life",
  "city",
];

const CATEGORY_ICONS: Record<Category, string> = {
  campus: "🏛️",
  dorms: "🏠",
  classrooms: "🎓",
  library: "📚",
  city: "🌆",
  sports: "🏟️",
  labs: "🔬",
  student_life: "🎉",
};

const LOADING_STEPS = [
  "Определяем университет или колледж…",
  "Ищем фотографии и официальные аккаунты…",
  "Отсеиваем дубликаты…",
  "Проверяем достоверность через AI…",
];

const PRESET_QUERIES = [
  "Nazarbayev University",
  "Satbayev University",
  "Massachusetts Institute of Technology",
  "МГУ",
];

const STEPS = [
  { n: "01", label: "Название", text: "Вводите название вуза или колледжа на русском или английском." },
  { n: "02", label: "Поиск", text: "Собираем фото из открытых архивов, с официального сайта и находим официальные соцсети." },
  { n: "03", label: "Проверка", text: "AI сверяет каждое фото с учебным заведением и убирает дубликаты." },
  { n: "04", label: "Профиль", text: "Получаете профиль: категории, краткое описание каждого фото и источники." },
];

const TRUST = [
  {
    icon: "🤖",
    title: "AI-верификация",
    text: "Gemini Vision сверяет каждое фото с названием учебного заведения и городом, а не просто доверяет подписи.",
  },
  {
    icon: "🛡️",
    title: "Честная неопределённость",
    text: "Если принадлежность фото не удаётся подтвердить, мы понижаем оценку, а не выдаём желаемое за действительное.",
  },
  {
    icon: "📸",
    title: "Официальные соцсети",
    text: "Находим Instagram и другие аккаунты вуза по его официальному сайту и Wikidata — там живёт настоящая студенческая жизнь.",
  },
  {
    icon: "🔗",
    title: "Прозрачные источники",
    text: "У каждого фото — кликабельный первоисточник: Wikimedia Commons, Openverse или сайт учебного заведения.",
  },
];

function Crest({ size = 40, tone = "brand" }: { size?: number; tone?: "brand" | "light" }) {
  const stroke = tone === "brand" ? "var(--brand)" : "#f7f2e7";
  const accent = "var(--gold)";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M24 3 6 9v14c0 11 7.5 18.5 18 22 10.5-3.5 18-11 18-22V9L24 3Z"
        stroke={stroke}
        strokeWidth="2"
        fill={tone === "brand" ? "rgba(31,74,61,0.06)" : "rgba(247,242,231,0.08)"}
      />
      <path d="M24 13v20M14 20l10-5 10 5M16 33h16" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SocialIcon({ platform }: { platform: SocialLink["platform"] }) {
  if (platform === "instagram") {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  const abbr: Record<string, string> = {
    tiktok: "Tk", youtube: "Yt", facebook: "f", telegram: "Tg", vk: "VK", x: "X", linkedin: "in",
  };
  return <span className="text-xs font-bold leading-none">{abbr[platform]}</span>;
}

function Splash({ dismissed, onSkip }: { dismissed: boolean; onSkip: () => void }) {
  return (
    <div
      className={`splash ${dismissed ? "dismissed" : ""}`}
      onClick={onSkip}
      role="presentation"
    >
      <div className="text-center px-6">
        <div className="splash-crest flex justify-center mb-6">
          <Crest size={84} />
        </div>
        <h1 className="splash-title font-serif text-4xl sm:text-6xl font-semibold text-brand tracking-tight">
          Campus Vision
        </h1>
        <div className="splash-line mx-auto my-5 h-px w-48 bg-gold" />
        <p className="splash-sub text-muted text-sm sm:text-base tracking-[0.2em] uppercase">
          Визуальный профиль университета
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  const [splashDismissed, setSplashDismissed] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<UniversityProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<Category | "all">("all");
  const [selectedPhoto, setSelectedPhoto] = useState<VerifiedImage | null>(null);

  async function handleSearch(overrideQuery?: string) {
    const q = (overrideQuery ?? query).trim();
    if (!q || loading) return;
    if (overrideQuery) setQuery(overrideQuery);
    setLoading(true);
    setError(null);
    setProfile(null);
    setActiveFilter("all");
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка поиска");
      setProfile(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  }

  function resetSearch() {
    setProfile(null);
    setError(null);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const visibleCategories = profile
    ? (Object.keys(profile.categories) as Category[]).filter(
        (c) => activeFilter === "all" || c === activeFilter
      )
    : [];

  const showHome = !profile && !loading;

  const searchBox = (
    <div className="max-w-2xl mx-auto">
      <div className="card rounded-full p-1.5 flex gap-2 focus-within:border-brand transition">
        <div className="flex items-center pl-4 text-muted">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <input
          className="flex-1 min-w-0 bg-transparent outline-none px-2 py-3 text-ink placeholder:text-muted/70"
          placeholder="Например: Nazarbayev University"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button
          onClick={() => handleSearch()}
          disabled={loading}
          className="btn-primary px-7 py-3 rounded-full font-medium disabled:opacity-50"
        >
          {loading ? "Ищем…" : "Найти"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <Splash dismissed={splashDismissed} onSkip={() => setSplashDismissed(true)} />

      <header className="sticky top-0 z-40 bg-milk/90 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={resetSearch} className="flex items-center gap-3">
            <Crest size={32} />
            <span className="font-serif text-xl font-semibold text-brand">
              Campus Vision
            </span>
          </button>
          <nav className="flex items-center gap-5 text-sm text-muted">
            {profile ? (
              <button onClick={resetSearch} className="btn-outline px-4 py-1.5 rounded-full font-medium">
                ← Новый поиск
              </button>
            ) : (
              <>
                <a href="#how" className="hidden sm:inline hover:text-brand transition">Как это работает</a>
                <a href="#trust" className="hidden sm:inline hover:text-brand transition">Почему доверять</a>
                <a href="#search" className="btn-outline px-4 py-1.5 rounded-full font-medium">Поиск</a>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full">
        {(showHome || loading) && (
          <section id="search" className="border-b border-line bg-gradient-to-b from-paper to-milk">
            <div className="max-w-4xl mx-auto px-4 pt-20 pb-20 sm:pt-28 sm:pb-24 text-center">
              <p className="text-gold text-xs sm:text-sm tracking-[0.25em] uppercase mb-5">
                Абитуриентам · Студентам · Родителям
              </p>
              <h2 className="font-serif text-4xl sm:text-6xl font-semibold text-brand leading-[1.1] mb-6">
                Увидьте университет
                <br />
                таким, какой он есть
              </h2>
              <span className="rule mx-auto mb-6" />
              <p className="text-muted text-lg max-w-xl mx-auto mb-10">
                Введите название — мы найдём, проверим и разложим по категориям
                реальные фото кампуса, общежитий и города, а ещё покажем
                официальные аккаунты вуза в Instagram и других соцсетях.
              </p>
              {searchBox}
              {showHome && (
                <div className="mt-5 flex items-center flex-wrap justify-center gap-2">
                  <span className="text-xs text-muted">Быстрый тест:</span>
                  {PRESET_QUERIES.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => handleSearch(preset)}
                      className="text-xs px-3.5 py-1.5 rounded-full card text-muted hover:text-brand hover:border-brand transition"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {showHome && (
          <>
            <section id="how" className="max-w-6xl mx-auto px-4 py-20">
              <div className="text-center mb-12">
                <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-brand mb-4">
                  Как это работает
                </h2>
                <span className="rule mx-auto" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {STEPS.map((step) => (
                  <div key={step.n} className="card rounded-xl p-6">
                    <div className="font-serif text-3xl text-gold mb-3">{step.n}</div>
                    <h3 className="font-serif text-lg font-semibold text-brand mb-2">{step.label}</h3>
                    <p className="text-sm text-muted leading-relaxed">{step.text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section id="trust" className="bg-milk-deep border-y border-line">
              <div className="max-w-6xl mx-auto px-4 py-20">
                <div className="text-center mb-12">
                  <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-brand mb-4">
                    Почему можно доверять
                  </h2>
                  <span className="rule mx-auto" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {TRUST.map((card) => (
                    <div key={card.title} className="card rounded-xl p-6 flex gap-4">
                      <div className="text-3xl">{card.icon}</div>
                      <div>
                        <h3 className="font-serif text-lg font-semibold text-brand mb-1">{card.title}</h3>
                        <p className="text-sm text-muted leading-relaxed">{card.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {loading && (
          <div className="max-w-md mx-auto text-center space-y-3 py-16">
            <div className="mx-auto w-10 h-10 rounded-full border-2 border-line border-t-brand animate-spin" />
            {LOADING_STEPS.map((step, i) => (
              <div
                key={step}
                className="text-muted text-sm"
                style={{ animation: `fade-step 6s ease-in-out ${i * 1.5}s infinite` }}
              >
                {step}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="max-w-2xl mx-auto mt-8 px-4">
            <div className="card rounded-xl p-4 text-red-800" style={{ borderColor: "rgba(185, 28, 28, 0.3)" }}>
              {error}
            </div>
          </div>
        )}

        {profile && (
          <div className="fade-in">
            {/* Profile banner, like a university page header */}
            <section className="bg-brand text-milk">
              <div className="max-w-6xl mx-auto px-4 py-14 sm:py-16">
                <p className="text-gold-soft text-xs tracking-[0.25em] uppercase mb-4 flex items-center gap-3">
                  <Crest size={22} tone="light" />
                  Визуальный профиль
                  <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">
                    <span className="px-2.5 py-1 rounded-full bg-white/10 text-milk text-xs">
                      {(profile.searchTimeMs / 1000).toFixed(1)} сек
                    </span>
                    {profile.cached && (
                      <span className="px-2.5 py-1 rounded-full bg-white/10 text-milk text-xs">из кэша</span>
                    )}
                  </span>
                </p>
                <h2 className="font-serif text-3xl sm:text-5xl font-semibold leading-tight mb-3">
                  {profile.resolvedName}
                </h2>
                {profile.city && (
                  <p className="text-gold-soft mb-6">
                    📍 {profile.city}
                    {profile.country ? `, ${profile.country}` : ""}
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  {profile.website && (
                    <a
                      href={profile.website}
                      target="_blank"
                      rel="noreferrer"
                      className="px-5 py-2.5 rounded-full bg-milk text-brand text-sm font-medium hover:bg-white transition"
                    >
                      Официальный сайт ↗
                    </a>
                  )}
                  {profile.wikiUrl && (
                    <a
                      href={profile.wikiUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-5 py-2.5 rounded-full border border-milk/40 text-milk text-sm font-medium hover:bg-white/10 transition"
                    >
                      Wikipedia ↗
                    </a>
                  )}
                </div>
              </div>
            </section>

            <div className="max-w-6xl mx-auto px-4 py-12">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
                <div className="card rounded-xl p-6 lg:col-span-2">
                  <h3 className="font-serif text-xl font-semibold text-brand mb-1">О вузе</h3>
                  <span className="rule mb-4" />
                  <p className="text-ink/80 leading-relaxed">{profile.description}</p>
                </div>

                <div className="card rounded-xl p-6">
                  <h3 className="font-serif text-xl font-semibold text-brand mb-1">Соцсети</h3>
                  <span className="rule mb-4" />
                  {profile.socials.length > 0 ? (
                    <ul className="space-y-2.5">
                      {profile.socials.map((s, i) => (
                        <li key={s.platform}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition ${
                              i === 0 && s.platform === "instagram"
                                ? "bg-brand text-milk hover:bg-brand-deep"
                                : "border border-line hover:border-brand text-ink"
                            }`}
                          >
                            <span
                              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                                i === 0 && s.platform === "instagram"
                                  ? "bg-white/15"
                                  : "bg-gold-soft text-brand"
                              }`}
                            >
                              <SocialIcon platform={s.platform} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">{SOCIAL_LABELS[s.platform]}</span>
                              <span className="block text-xs opacity-70 truncate">
                                {s.handle} · {s.source === "official_site" ? "с сайта вуза" : "Wikidata"}
                              </span>
                            </span>
                            <span className="opacity-60">↗</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted leading-relaxed">
                      Официальные аккаунты не найдены: на сайте вуза нет ссылок на соцсети,
                      а в Wikidata они не указаны.
                    </p>
                  )}
                </div>
              </div>

              {profile.warnings.length > 0 && (
                <div
                  className="mb-8 p-4 rounded-xl card text-amber-900 text-sm space-y-1.5"
                  style={{ borderColor: "rgba(169, 131, 74, 0.5)", background: "#fbf3df" }}
                >
                  {profile.warnings.map((w, i) => (
                    <div key={i} className="flex gap-2">
                      <span>⚠️</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mb-10">
                {(["all", ...FILTERS.filter((f) => profile.categories[f])] as (Category | "all")[]).map(
                  (f) => (
                    <button
                      key={f}
                      onClick={() => setActiveFilter(f)}
                      className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
                        activeFilter === f
                          ? "btn-primary"
                          : "card text-muted hover:text-brand hover:border-brand"
                      }`}
                    >
                      {f === "all" ? "Все" : `${CATEGORY_ICONS[f]} ${CATEGORY_LABELS[f]}`}
                    </button>
                  )
                )}
              </div>

              {visibleCategories.map((cat) => (
                <section key={cat} className="mb-12">
                  <h3 className="font-serif text-2xl font-semibold mb-1 text-brand flex items-center gap-2">
                    <span>{CATEGORY_ICONS[cat]}</span>
                    {CATEGORY_LABELS[cat]}
                  </h3>
                  <span className="rule mb-6" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                    {profile.categories[cat]?.map((img, i) => (
                      <article
                        key={i}
                        className="group card rounded-xl overflow-hidden hover:-translate-y-1 transition-transform duration-300 flex flex-col"
                      >
                        <button
                          onClick={() => setSelectedPhoto(img)}
                          className="relative aspect-video bg-milk-deep overflow-hidden block w-full"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.thumbnailUrl || img.url}
                            alt={img.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                          <span
                            className={`absolute top-2 right-2 text-[11px] px-2 py-0.5 rounded-full font-semibold backdrop-blur-sm text-white ${
                              img.confidence >= 0.7
                                ? "bg-emerald-700/90"
                                : img.confidence >= 0.4
                                ? "bg-amber-600/90"
                                : "bg-stone-500/90"
                            }`}
                          >
                            {Math.round(img.confidence * 100)}%
                          </span>
                        </button>
                        <div className="p-4 flex flex-col gap-3 flex-1">
                          <p className="text-sm text-ink/80 leading-relaxed line-clamp-3 flex-1">
                            {img.caption || img.verificationNote || img.title}
                          </p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-muted truncate">
                              {getSourceLabel(img.sourcePage)}
                            </span>
                            <button
                              onClick={() => setSelectedPhoto(img)}
                              className="btn-outline shrink-0 px-4 py-1.5 rounded-full text-xs font-medium"
                            >
                              Подробнее
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-line bg-milk-deep">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted">
          <div className="flex items-center gap-3">
            <Crest size={26} />
            <span className="font-serif text-brand font-semibold">Campus Vision</span>
          </div>
          <p>LOCUS Startup Hackathon 2026 · Источники: Wikidata, Wikimedia Commons, Openverse, сайты вузов</p>
        </div>
      </footer>

      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-sm"
          onClick={() => setSelectedPhoto(null)}
        >
          <div
            className="card bg-paper rounded-2xl max-w-lg w-full max-h-[92vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative aspect-video bg-milk-deep">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedPhoto.thumbnailUrl || selectedPhoto.url}
                alt={selectedPhoto.title}
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => setSelectedPhoto(null)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-paper/90 text-muted hover:text-ink flex items-center justify-center shadow-md"
                aria-label="Закрыть"
              >
                ✕
              </button>
              <span
                className={`absolute bottom-3 left-3 text-xs px-2.5 py-1 rounded-full font-semibold text-white ${
                  selectedPhoto.confidence >= 0.7
                    ? "bg-emerald-700/90"
                    : selectedPhoto.confidence >= 0.4
                    ? "bg-amber-600/90"
                    : "bg-stone-500/90"
                }`}
              >
                {Math.round(selectedPhoto.confidence * 100)}% достоверность
              </span>
            </div>
            <div className="p-6 space-y-3">
              <h3 className="font-serif text-lg font-semibold text-brand">
                {selectedPhoto.title}
              </h3>
              {selectedPhoto.caption && (
                <p className="text-sm text-ink/80 leading-relaxed">{selectedPhoto.caption}</p>
              )}
              {selectedPhoto.verificationNote && (
                <p className="text-sm text-muted leading-relaxed border-l-2 border-gold pl-3">
                  Проверка: {selectedPhoto.verificationNote}
                </p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted pt-1">
                <span>{CATEGORY_ICONS[selectedPhoto.category]} {CATEGORY_LABELS[selectedPhoto.category]}</span>
                <span>·</span>
                <span>{getSourceLabel(selectedPhoto.sourcePage)}</span>
                {formatDate(selectedPhoto.contextDate) && (
                  <>
                    <span>·</span>
                    <span>{formatDate(selectedPhoto.contextDate)}</span>
                  </>
                )}
              </div>
              <a
                href={selectedPhoto.sourcePage}
                target="_blank"
                rel="noreferrer"
                className="btn-primary inline-flex items-center gap-1.5 mt-2 px-5 py-2.5 rounded-full text-sm font-medium"
              >
                Открыть первоисточник →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
