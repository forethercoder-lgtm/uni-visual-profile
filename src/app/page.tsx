"use client";

import { useState } from "react";
import { CATEGORY_LABELS, Category, UniversityProfile } from "@/lib/types";

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
  "Определяем университет…",
  "Ищем фотографии в открытых источниках…",
  "Отсеиваем дубликаты…",
  "Проверяем достоверность через AI…",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<UniversityProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<Category | "all">("all");

  async function handleSearch() {
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    setActiveFilter("all");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Ошибка поиска");
      setProfile(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  }

  const visibleCategories = profile
    ? (Object.keys(profile.categories) as Category[]).filter(
        (c) => activeFilter === "all" || c === activeFilter
      )
    : [];

  return (
    <main className="flex-1 w-full px-4 py-16 sm:py-20">
      <div className="max-w-3xl mx-auto text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-5 rounded-full glass text-xs font-medium text-white/70 tracking-wide uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          LOCUS Hackathon 2026 · Кейс 01
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 bg-gradient-to-br from-white via-white to-white/60 bg-clip-text text-transparent">
          Визуальный профиль
          <br />
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent">
            университета
          </span>
        </h1>
        <p className="text-white/60 text-lg max-w-xl mx-auto">
          Введите название — AI найдёт, проверит и разложит по категориям
          реальные фото кампуса, общежитий и города.
        </p>
      </div>

      <div className="max-w-2xl mx-auto mb-14">
        <div className="glass rounded-2xl p-2 flex gap-2 shadow-2xl shadow-black/20 focus-within:ring-2 focus-within:ring-indigo-500/50 transition">
          <div className="flex items-center pl-3 text-white/40">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <input
            className="flex-1 bg-transparent outline-none px-2 py-3 text-white placeholder:text-white/30"
            placeholder="Например: Nazarbayev University"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-medium disabled:opacity-50 hover:brightness-110 active:scale-[0.98] transition"
          >
            {loading ? "Ищем…" : "Найти"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="max-w-md mx-auto text-center space-y-3">
          {LOADING_STEPS.map((step, i) => (
            <div
              key={step}
              className="text-white/50 text-sm"
              style={{
                animation: `fade-step 6s ease-in-out ${i * 1.5}s infinite`,
              }}
            >
              {step}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div
          className="max-w-2xl mx-auto mb-6 p-4 rounded-xl glass text-red-300"
          style={{ borderColor: "rgba(248, 113, 113, 0.3)" }}
        >
          {error}
        </div>
      )}

      {profile && (
        <div className="max-w-5xl mx-auto">
          <div className="glass rounded-2xl p-6 mb-6">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-2">
              <h2 className="text-2xl font-semibold text-white">
                {profile.resolvedName}
              </h2>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300">
                {(profile.searchTimeMs / 1000).toFixed(1)} сек
              </span>
            </div>
            {profile.city && (
              <p className="text-white/40 text-sm mb-3">
                📍 {profile.city}
                {profile.country ? `, ${profile.country}` : ""}
              </p>
            )}
            <p className="text-white/70 leading-relaxed">{profile.description}</p>
          </div>

          {profile.warnings.length > 0 && (
            <div
              className="mb-6 p-4 rounded-xl glass text-amber-200/90 text-sm space-y-1.5"
              style={{ borderColor: "rgba(245, 158, 11, 0.25)" }}
            >
              {profile.warnings.map((w, i) => (
                <div key={i} className="flex gap-2">
                  <span>⚠️</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-8">
            <button
              onClick={() => setActiveFilter("all")}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition ${
                activeFilter === "all"
                  ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white"
                  : "glass text-white/60 hover:text-white"
              }`}
            >
              Все
            </button>
            {FILTERS.filter((f) => profile.categories[f]).map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition ${
                  activeFilter === f
                    ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white"
                    : "glass text-white/60 hover:text-white"
                }`}
              >
                {CATEGORY_ICONS[f]} {CATEGORY_LABELS[f]}
              </button>
            ))}
          </div>

          {visibleCategories.map((cat) => (
            <section key={cat} className="mb-10">
              <h3 className="text-lg font-semibold mb-4 text-white/90 flex items-center gap-2">
                <span>{CATEGORY_ICONS[cat]}</span>
                {CATEGORY_LABELS[cat]}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {profile.categories[cat]?.map((img, i) => (
                  <a
                    key={i}
                    href={img.sourcePage}
                    target="_blank"
                    rel="noreferrer"
                    className="group block rounded-xl overflow-hidden glass hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-300"
                  >
                    <div className="relative aspect-video bg-white/5 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.thumbnailUrl || img.url}
                        alt={img.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span
                        className={`absolute top-2 right-2 text-[11px] px-2 py-0.5 rounded-full font-semibold backdrop-blur-sm ${
                          img.confidence >= 0.7
                            ? "bg-emerald-500/80 text-white"
                            : img.confidence >= 0.4
                            ? "bg-amber-500/80 text-white"
                            : "bg-gray-500/80 text-white"
                        }`}
                      >
                        {Math.round(img.confidence * 100)}%
                      </span>
                    </div>
                    <div className="p-2.5 text-xs text-white/50 truncate group-hover:text-white/80 transition-colors">
                      {img.verificationNote || img.title}
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
