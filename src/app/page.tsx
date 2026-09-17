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
    <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-10">
      <h1 className="text-3xl font-bold mb-2">Визуальный профиль университета</h1>
      <p className="text-gray-500 mb-6">
        Введите название университета — сервис найдёт и проверит фотографии кампуса.
      </p>

      <div className="flex gap-2 mb-6">
        <input
          className="flex-1 border rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Например: Nazarbayev University"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-6 py-2 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50"
        >
          {loading ? "Ищем…" : "Найти"}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {profile && (
        <>
          <div className="mb-6">
            <h2 className="text-xl font-semibold">{profile.resolvedName}</h2>
            <p className="text-sm text-gray-400 mb-2">
              Найдено за {(profile.searchTimeMs / 1000).toFixed(1)} сек
            </p>
            <p className="text-gray-700">{profile.description}</p>
          </div>

          {profile.warnings.length > 0 && (
            <div className="mb-6 p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm space-y-1">
              {profile.warnings.map((w, i) => (
                <div key={i}>⚠️ {w}</div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setActiveFilter("all")}
              className={`px-3 py-1 rounded-full text-sm border ${
                activeFilter === "all"
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-700"
              }`}
            >
              Все
            </button>
            {FILTERS.filter((f) => profile.categories[f]).map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-3 py-1 rounded-full text-sm border ${
                  activeFilter === f
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-700"
                }`}
              >
                {CATEGORY_LABELS[f]}
              </button>
            ))}
          </div>

          {visibleCategories.map((cat) => (
            <section key={cat} className="mb-8">
              <h3 className="text-lg font-semibold mb-3">{CATEGORY_LABELS[cat]}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {profile.categories[cat]?.map((img, i) => (
                  <a
                    key={i}
                    href={img.sourcePage}
                    target="_blank"
                    rel="noreferrer"
                    className="group block rounded-lg overflow-hidden border hover:shadow-lg transition"
                  >
                    <div className="relative aspect-video bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.thumbnailUrl || img.url}
                        alt={img.title}
                        className="w-full h-full object-cover"
                      />
                      <span
                        className={`absolute top-2 right-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                          img.confidence >= 0.7
                            ? "bg-green-600 text-white"
                            : img.confidence >= 0.4
                            ? "bg-amber-500 text-white"
                            : "bg-gray-500 text-white"
                        }`}
                      >
                        {Math.round(img.confidence * 100)}%
                      </span>
                    </div>
                    <div className="p-2 text-xs text-gray-500 truncate">
                      {img.verificationNote || img.title}
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
