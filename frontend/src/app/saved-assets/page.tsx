"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
    ArrowLeft, Download, Image as ImageIcon, Video as VideoIcon,
    Music, Layers, Search, Trash2, Sparkles, Globe, RefreshCw
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type AssetType = "image" | "video" | "audio";
type FilterTab = "all" | AssetType;

type SavedAsset = {
    id: string;
    media_url: string;
    asset_type: AssetType;
    description: string | null;
    source: string | null;
    relevance_score: number | null;
    classification: Record<string, unknown> | null;
    prompt: string | null;
    created_at: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const TAB_CONFIG: { id: FilterTab; label: string; icon: React.ReactNode }[] = [
    { id: "all", label: "All", icon: <Layers className="w-3.5 h-3.5" /> },
    { id: "image", label: "Images", icon: <ImageIcon className="w-3.5 h-3.5" /> },
    { id: "video", label: "Videos", icon: <VideoIcon className="w-3.5 h-3.5" /> },
    { id: "audio", label: "Audio", icon: <Music className="w-3.5 h-3.5" /> },
];

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
    });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SavedAssetsPage() {
    const [assets, setAssets] = useState<SavedAsset[]>([]);
    const [filter, setFilter] = useState<FilterTab>("all");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState<string | null>(null);

    const fetchAssets = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from("saved_assets")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("saved_assets fetch error:", error);
        } else {
            setAssets((data as SavedAsset[]) ?? []);
        }
        setLoading(false);
    };

    useEffect(() => { fetchAssets(); }, []);

    const handleDelete = async (id: string) => {
        setDeleting(id);
        const { error } = await supabase.from("saved_assets").delete().eq("id", id);
        if (!error) setAssets((p) => p.filter((a) => a.id !== id));
        setDeleting(null);
    };

    const filtered = assets.filter((a) => {
        const matchType = filter === "all" || a.asset_type === filter;
        const matchSearch = !search ||
            (a.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
            (a.prompt ?? "").toLowerCase().includes(search.toLowerCase());
        return matchType && matchSearch;
    });

    const counts = {
        all: assets.length,
        image: assets.filter((a) => a.asset_type === "image").length,
        video: assets.filter((a) => a.asset_type === "video").length,
        audio: assets.filter((a) => a.asset_type === "audio").length,
    };

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div className="min-h-screen bg-[#080808] text-zinc-100 font-sans">

            {/* Header */}
            <header className="sticky top-0 z-30 border-b border-zinc-900 bg-[#080808]/90 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                        <Link href="/chat" className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors flex-shrink-0">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <div>
                            <h1 className="text-base font-semibold tracking-tight text-white leading-none">Asset Library</h1>
                            <span className="text-[10px] text-zinc-500 font-mono">{assets.length} saved assets</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Search */}
                        <div className="relative hidden sm:flex items-center">
                            <Search className="absolute left-3 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search assets…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-8 pr-4 py-1.5 text-[13px] bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 w-48"
                            />
                        </div>
                        <button
                            onClick={fetchAssets}
                            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Tab bar */}
                <div className="max-w-7xl mx-auto px-6 pb-0 flex gap-1 overflow-x-auto no-scrollbar">
                    {TAB_CONFIG.map(({ id, label, icon }) => (
                        <button
                            key={id}
                            onClick={() => setFilter(id)}
                            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition-all whitespace-nowrap ${filter === id
                                    ? "border-indigo-500 text-indigo-400"
                                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                                }`}
                        >
                            {icon}
                            {label}
                            <span className={`ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono ${filter === id ? "bg-indigo-500/20 text-indigo-400" : "bg-zinc-800 text-zinc-500"
                                }`}>
                                {counts[id]}
                            </span>
                        </button>
                    ))}
                </div>
            </header>

            {/* Main content */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

                {/* Loading */}
                {loading && (
                    <div className="flex flex-col items-center justify-center py-32 gap-4">
                        <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                        <p className="text-zinc-500 text-sm">Loading your library…</p>
                    </div>
                )}

                {/* Empty state */}
                {!loading && filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
                        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-2">
                            <Layers className="w-7 h-7 text-zinc-600" />
                        </div>
                        <h2 className="text-lg font-semibold text-zinc-300">
                            {search ? "No assets match your search" : "No saved assets yet"}
                        </h2>
                        <p className="text-zinc-500 text-sm max-w-xs">
                            {search
                                ? "Try a different search term or clear the filter."
                                : "Generate some media in the chat and your results will appear here, categorized by type."}
                        </p>
                        {!search && (
                            <Link href="/chat" className="mt-2 px-5 py-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
                                Open Chat →
                            </Link>
                        )}
                    </div>
                )}

                {/* Audio section */}
                {!loading && filtered.some((a) => a.asset_type === "audio") && (
                    <section className="mb-10">
                        {(filter === "all") && (
                            <SectionHeader icon={<Music className="w-4 h-4 text-purple-400" />} label="Audio" count={counts.audio} />
                        )}
                        <div className="flex flex-col gap-3">
                            <AnimatePresence>
                                {filtered.filter((a) => a.asset_type === "audio").map((asset) => (
                                    <AudioCard key={asset.id} asset={asset} onDelete={handleDelete} deleting={deleting} />
                                ))}
                            </AnimatePresence>
                        </div>
                    </section>
                )}

                {/* Video section */}
                {!loading && filtered.some((a) => a.asset_type === "video") && (
                    <section className="mb-10">
                        {(filter === "all") && (
                            <SectionHeader icon={<VideoIcon className="w-4 h-4 text-blue-400" />} label="Videos" count={counts.video} />
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            <AnimatePresence>
                                {filtered.filter((a) => a.asset_type === "video").map((asset) => (
                                    <MediaCard key={asset.id} asset={asset} onDelete={handleDelete} deleting={deleting} />
                                ))}
                            </AnimatePresence>
                        </div>
                    </section>
                )}

                {/* Image section */}
                {!loading && filtered.some((a) => a.asset_type === "image") && (
                    <section className="mb-10">
                        {(filter === "all") && (
                            <SectionHeader icon={<ImageIcon className="w-4 h-4 text-emerald-400" />} label="Images" count={counts.image} />
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            <AnimatePresence>
                                {filtered.filter((a) => a.asset_type === "image").map((asset) => (
                                    <MediaCard key={asset.id} asset={asset} onDelete={handleDelete} deleting={deleting} />
                                ))}
                            </AnimatePresence>
                        </div>
                    </section>
                )}

            </main>
        </div>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
    return (
        <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                {icon}
            </div>
            <h2 className="text-sm font-semibold text-zinc-200">{label}</h2>
            <span className="text-[11px] font-mono text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded">{count}</span>
            <div className="flex-1 h-px bg-zinc-900" />
        </div>
    );
}

function SourceBadge({ source }: { source: string | null }) {
    const isGenerated = source === "fal_ai" || (source ?? "").toLowerCase().includes("fal");
    return isGenerated ? (
        <span className="flex items-center gap-1 text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded-full font-mono">
            <Sparkles className="w-2.5 h-2.5" /> AI
        </span>
    ) : (
        <span className="flex items-center gap-1 text-[10px] text-zinc-400 bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded-full font-mono">
            <Globe className="w-2.5 h-2.5" /> Web
        </span>
    );
}

// ── Audio card (full-width row) ────────────────────────────────────────────────

function AudioCard({ asset, onDelete, deleting }: {
    asset: SavedAsset;
    onDelete: (id: string) => void;
    deleting: string | null;
}) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            className="group flex flex-col sm:flex-row gap-4 p-4 rounded-xl border border-zinc-800/70 bg-zinc-900/30 hover:bg-zinc-900/60 transition-colors"
        >
            {/* Player */}
            <div className="flex-1 min-w-0">
                <div className="bg-gradient-to-r from-indigo-950/60 to-zinc-900 rounded-lg border border-indigo-800/20 p-4">
                    {/* Mini waveform deco */}
                    <div className="flex items-end gap-[2px] h-6 mb-3 opacity-60">
                        {[3, 6, 9, 5, 11, 8, 13, 7, 10, 5, 9, 4, 12, 6, 8, 5, 10, 7, 11, 6, 8, 4, 9, 5, 3].map((h, i) => (
                            <div key={i} className="flex-1 rounded-full bg-indigo-400" style={{ height: `${h * 1.8}px` }} />
                        ))}
                    </div>
                    <audio src={asset.media_url} controls className="w-full" style={{ colorScheme: "dark", height: "32px" }} />
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-2 gap-y-1 items-center">
                    <SourceBadge source={asset.source} />
                    {asset.relevance_score != null && (
                        <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                            {(asset.relevance_score * 100).toFixed(0)}% match
                        </span>
                    )}
                    <span className="text-[10px] text-zinc-600 font-mono">{formatDate(asset.created_at)}</span>
                </div>
            </div>

            {/* Meta */}
            <div className="sm:w-52 flex flex-col justify-between gap-2 flex-shrink-0">
                {asset.description && (
                    <p className="text-[12px] text-zinc-400 leading-relaxed line-clamp-3">{asset.description}</p>
                )}
                {asset.prompt && (
                    <p className="text-[11px] text-zinc-600 font-mono line-clamp-2 italic">"{asset.prompt}"</p>
                )}
                <div className="flex gap-2 mt-auto">
                    <a href={asset.media_url} download target="_blank" rel="noreferrer" className="flex-1">
                        <button className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium transition-colors border border-zinc-700">
                            <Download className="w-3 h-3" /> Download
                        </button>
                    </a>
                    <button
                        onClick={() => onDelete(asset.id)}
                        disabled={deleting === asset.id}
                        className="p-1.5 rounded-lg bg-zinc-800 hover:bg-red-900/40 hover:border-red-800/50 text-zinc-500 hover:text-red-400 transition-colors border border-zinc-700"
                    >
                        {deleting === asset.id
                            ? <div className="w-4 h-4 border border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />
                        }
                    </button>
                </div>
            </div>
        </motion.div>
    );
}

// ── Image / Video card (grid tile) ────────────────────────────────────────────

function MediaCard({ asset, onDelete, deleting }: {
    asset: SavedAsset;
    onDelete: (id: string) => void;
    deleting: string | null;
}) {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="group relative rounded-xl overflow-hidden border border-zinc-800/60 bg-zinc-900/30 hover:border-zinc-700 transition-all"
        >
            {/* Media */}
            <div className="aspect-video bg-black overflow-hidden">
                {asset.asset_type === "video" ? (
                    <video src={asset.media_url} muted loop autoPlay playsInline className="w-full h-full object-cover" />
                ) : (
                    <img src={asset.media_url} alt={asset.description ?? ""} className="w-full h-full object-cover" />
                )}
            </div>

            {/* Hover overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 gap-2">
                {asset.description && (
                    <p className="text-[11px] text-zinc-300 line-clamp-2 leading-relaxed">{asset.description}</p>
                )}
                <div className="flex items-center gap-1.5">
                    <SourceBadge source={asset.source} />
                    {asset.relevance_score != null && (
                        <span className="text-[10px] font-mono text-zinc-400">{(asset.relevance_score * 100).toFixed(0)}%</span>
                    )}
                    <div className="ml-auto flex gap-1">
                        <a href={asset.media_url} download target="_blank" rel="noreferrer">
                            <button className="p-1.5 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 transition-colors border border-zinc-700 backdrop-blur-sm">
                                <Download className="w-3 h-3" />
                            </button>
                        </a>
                        <button
                            onClick={() => onDelete(asset.id)}
                            disabled={deleting === asset.id}
                            className="p-1.5 rounded-lg bg-zinc-800/90 hover:bg-red-900/60 text-zinc-400 hover:text-red-400 transition-colors border border-zinc-700 backdrop-blur-sm"
                        >
                            {deleting === asset.id
                                ? <div className="w-3 h-3 border border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                                : <Trash2 className="w-3 h-3" />
                            }
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom meta strip */}
            <div className="px-3 py-2 flex items-center justify-between border-t border-zinc-800/50">
                <span className="text-[10px] text-zinc-600 font-mono">{formatDate(asset.created_at)}</span>
                {asset.prompt && (
                    <span className="text-[10px] text-zinc-600 italic truncate max-w-[120px]" title={asset.prompt}>"{asset.prompt}"</span>
                )}
            </div>
        </motion.div>
    );
}
