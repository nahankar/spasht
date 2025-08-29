import { Button } from "@/components/ui/button";
import { ArrowRight, Mic, Brain, Target, Trophy } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Navigation */}
      <nav className="flex items-center justify-between p-6 max-w-7xl mx-auto">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg"></div>
          <span className="text-xl font-bold text-gray-900">spasht</span>
        </div>
        <div className="flex items-center space-x-4">
          <Link href="/sign-in">
            <Button variant="ghost">Sign In</Button>
          </Link>
          <Link href="/sign-up">
            <Button>Get Started</Button>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold text-gray-900">
              Master Your Next{" "}
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Job Interview
              </span>
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              AI-powered interview coaching with real-time feedback, fluency training, 
              and personalized tips to boost your confidence and land your dream job.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/practice">
              <Button size="lg" className="text-lg px-8 py-3">
                Start Free Practice
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Button variant="outline" size="lg" className="text-lg px-8 py-3">
              Watch Demo
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mt-24 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          <FeatureCard
            icon={<Mic className="h-8 w-8 text-blue-600" />}
            title="Real-time Feedback"
            description="Get instant nudges on pacing, filler words, and confidence during practice sessions"
          />
          <FeatureCard
            icon={<Brain className="h-8 w-8 text-purple-600" />}
            title="AI Interview Coach"
            description="Practice with AI-generated questions tailored to your target role and experience"
          />
          <FeatureCard
            icon={<Target className="h-8 w-8 text-green-600" />}
            title="Fluency Training"
            description="Improve pronunciation, grammar, and communication clarity with personalized coaching"
          />
          <FeatureCard
            icon={<Trophy className="h-8 w-8 text-orange-600" />}
            title="Track Progress"
            description="Monitor improvement with detailed analytics, scores, and achievement badges"
          />
        </div>

        {/* Stats Section */}
        <div className="mt-24 bg-white rounded-2xl shadow-xl p-12">
          <div className="text-center space-y-8">
            <h2 className="text-3xl font-bold text-gray-900">
              Trusted by Students & Professionals
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <StatCard number="10,000+" label="Practice Sessions" />
              <StatCard number="85%" label="Success Rate" />
              <StatCard number="4.9/5" label="User Rating" />
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-24 bg-gray-50 py-12">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <div className="w-6 h-6 bg-gradient-to-r from-blue-600 to-purple-600 rounded"></div>
            <span className="text-lg font-semibold text-gray-900">spasht</span>
          </div>
      <p className="text-gray-600">
        © {new Date().getFullYear()} spasht • <a href="/admin" className="underline">Admin</a>
      </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow">
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="p-3 bg-gray-50 rounded-lg">{icon}</div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="text-gray-600 text-sm">{description}</p>
      </div>
    </div>
  );
}

function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-bold text-blue-600">{number}</div>
      <div className="text-gray-600 mt-1">{label}</div>
    </div>
  );
}
