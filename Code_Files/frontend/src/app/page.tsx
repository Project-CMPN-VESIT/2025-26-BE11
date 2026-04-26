"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Layers, Cpu, Globe2, Zap, LayoutTemplate } from "lucide-react";
import { useEffect, useState } from "react";

const ParticleField = () => {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; size: number; duration: number; delay: number }>>([]);

  useEffect(() => {
    // Generate organic floating particles for the "fantastic background"
    const generateParticles = Array.from({ length: 40 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 1,
      duration: Math.random() * 20 + 15,
      delay: Math.random() * 10,
    }));
    setParticles(generateParticles);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-white/20"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [0, -100, 0],
            x: [0, Math.random() * 50 - 25, 0],
            opacity: [0.1, 0.4, 0.1],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeInOut",
          }}
        />
      ))}
      {/* Deep Space Gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/30 blur-[150px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-purple-900/20 blur-[150px]" />
      <div className="absolute top-[40%] left-[30%] w-[30%] h-[30%] rounded-full bg-blue-900/20 blur-[100px]" />
    </div>
  );
};

const FadeIn = ({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 30 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-100px" }}
    transition={{ duration: 0.8, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
  >
    {children}
  </motion.div>
);

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white font-sans overflow-x-hidden selection:bg-indigo-500/30">
      <ParticleField />

      {/* Navigation */}
      <motion.nav
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="fixed top-0 w-full z-50 border-b border-white/5 bg-black/40 backdrop-blur-2xl"
      >
        <div className="container mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3 group cursor-pointer">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center transform group-hover:scale-105 transition-transform duration-300 shadow-[0_0_20px_rgba(99,102,241,0.3)]">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white via-white/90 to-white/60">
              AutoGenie
            </span>
          </div>
          <div className="flex items-center">
            <Link href="/chat">
              <Button className="bg-white text-black hover:bg-zinc-200 hover:scale-105 transition-all duration-300 rounded-full px-6 font-medium shadow-[0_0_20px_rgba(255,255,255,0.15)] group">
                Start Chat <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
        </div>
      </motion.nav>

      <main className="relative z-10 pt-40 pb-24 px-6">
        <div className="container mx-auto">
          {/* Hero Section */}
          <div className="max-w-5xl mx-auto text-center flex flex-col items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, type: "spring" }}
              className="inline-flex items-center px-4 py-2 rounded-full border border-white/10 bg-white/5 text-zinc-300 text-sm font-medium mb-8 backdrop-blur-md"
            >
              <Zap className="w-4 h-4 mr-2 text-indigo-400" />
              <span className="tracking-wide uppercase text-xs">The Novelty of Agentic Orchestration</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease: [0.21, 0.47, 0.32, 0.98] }}
              className="text-6xl md:text-8xl font-black tracking-tighter leading-[1.1] mb-8"
            >
              Generate media with <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-br from-indigo-400 via-purple-400 to-white pb-2 inline-block">
                cognitive intent.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-xl md:text-2xl text-zinc-400 max-w-3xl mx-auto leading-relaxed font-light mb-12"
            >
              AutoGenie doesn't just pass prompts to a generator. It actively breaks down your request, reasons about the optimal strategy, scrapes the web for real-world moodboards, and synthesizes cinematic multimodal assets using state-of-the-art vision logic.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              <Link href="/chat">
                <Button size="lg" className="h-16 px-10 text-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-full shadow-[0_0_40px_rgba(99,102,241,0.4)] hover:shadow-[0_0_60px_rgba(99,102,241,0.6)] hover:scale-105 transition-all duration-300 group font-semibold tracking-wide">
                  Start Chat <ArrowRight className="ml-3 w-5 h-5 group-hover:translate-x-2 transition-transform" />
                </Button>
              </Link>
            </motion.div>
          </div>

          {/* Abstract Interface Preview Hologram */}
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.4, type: "spring", bounce: 0.3 }}
            className="mt-32 relative max-w-5xl mx-auto"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent z-10 rounded-3xl" />
            <div className="relative rounded-3xl border border-white/10 bg-white/5 backdrop-blur-3xl overflow-hidden shadow-2xl p-2 h-[400px] flex flex-col">
              <div className="flex items-center px-4 py-3 border-b border-white/5">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/50" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                  <div className="w-3 h-3 rounded-full bg-green-500/50" />
                </div>
                <div className="ml-4 px-3 py-1 bg-white/5 rounded-md text-xs font-mono text-zinc-500 flex items-center">
                  <LayoutTemplate className="w-3 h-3 mr-2" />
                  autogenie-agentic-pipeline.ts
                </div>
              </div>
              <div className="p-6 font-mono text-xs sm:text-sm text-zinc-400 space-y-4 flex-1 overflow-hidden">
                {[
                  { text: "🚀 AutoGenie Pipeline Initializing...", color: "text-zinc-400", delay: 0 },
                  { text: "⚙️  Prompt analyzed — extracting core visual semantics.", color: "text-indigo-400", delay: 0.8 },
                  { text: "🌐 Invoking Web Scraper for real-world moodboard references.", color: "text-zinc-400", delay: 1.6 },
                  { text: "🔍 Running Relevance Matcher on scraped assets.", color: "text-purple-400", delay: 2.4 },
                  { text: "🏷️  Running Asset Classifier — building semantic maps.", color: "text-zinc-400", delay: 3.2 },
                  { text: "✅ Pipeline complete. Relevant assets identified.", color: "text-emerald-400", delay: 4.0 },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    className={item.color}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5, delay: item.delay, repeat: Infinity, repeatDelay: 5 }}
                  >
                    &gt; {item.text}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* System Details grid */}
          <div className="mt-40 grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
            <FadeIn delay={0.1}>
              <div className="group p-8 rounded-3xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors h-full">
                <div className="w-14 h-14 bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Cpu className="w-7 h-7 text-indigo-400" />
                </div>
                <h3 className="text-2xl font-bold mb-4 tracking-tight">Autonomous Reasoning</h3>
                <p className="text-zinc-400 leading-relaxed font-light">
                  Our decision engine determines the precise modality requirements. If your prompt is vague, AutoGenie actively asks for clarification, ensuring optimal pipeline execution.
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.2}>
              <div className="group p-8 rounded-3xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors h-full">
                <div className="w-14 h-14 bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Globe2 className="w-7 h-7 text-purple-400" />
                </div>
                <h3 className="text-2xl font-bold mb-4 tracking-tight">Real-time Web Scraping</h3>
                <p className="text-zinc-400 leading-relaxed font-light">
                  Generative models lack true grounding. AutoGenie scrapes live data blocks to build moodboards, grounding generations against scraped references through relevance-matching.
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.3}>
              <div className="group p-8 rounded-3xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors h-full">
                <div className="w-14 h-14 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Layers className="w-7 h-7 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold mb-4 tracking-tight">Classification Semantic Maps</h3>
                <p className="text-zinc-400 leading-relaxed font-light">
                  Images aren't just generated; they are rigorously classified. Every asset gets a deep tabular breakdown of Lighting, Composition, Camera Angle, and Atmosphere parameters.
                </p>
              </div>
            </FadeIn>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 bg-[#000000] py-12 mt-20">
        <div className="container mx-auto px-6 flex flex-col items-center">
          <div className="w-10 h-10 bg-indigo-500/20 border border-indigo-500/50 rounded-xl flex items-center justify-center mb-6">
            <Sparkles className="w-5 h-5 text-indigo-400" />
          </div>
          <p className="text-sm text-zinc-600 font-mono tracking-widest uppercase mb-2">AutoGenie · Agentic Multimodal Pipeline</p>
          <p className="text-xs text-zinc-700">© {new Date().getFullYear()} AutoGenie — AI Video Generation Platform. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
