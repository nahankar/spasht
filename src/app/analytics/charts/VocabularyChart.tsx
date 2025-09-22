"use client";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface VocabularyChartProps {
  data: {
    sentences: number;
    avgSentenceLength: number;
    shortSentences: number;
    longSentences: number;
    vocabularyRichness: number;
    uniqueWords: number;
  };
}

export default function VocabularyChart({ data }: VocabularyChartProps) {
  const normalSentences = data.sentences - data.shortSentences - data.longSentences;
  
  const chartData = {
    labels: ["Short (<5 words)", "Normal (5-20 words)", "Long (>20 words)"],
    datasets: [
      {
        label: "Sentence Distribution",
        data: [data.shortSentences, normalSentences, data.longSentences],
        backgroundColor: [
          "rgba(239, 68, 68, 0.8)",   // Red for short
          "rgba(16, 185, 129, 0.8)",  // Green for normal
          "rgba(245, 158, 11, 0.8)",  // Orange for long
        ],
        borderColor: [
          "rgba(239, 68, 68, 1)",
          "rgba(16, 185, 129, 1)",
          "rgba(245, 158, 11, 1)",
        ],
        borderWidth: 2,
        borderRadius: 6,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function (context: { parsed: { y: number } }) {
            const total = data.sentences;
            const percentage = total > 0 ? ((context.parsed.y / total) * 100).toFixed(1) : "0";
            return `${context.parsed.y} sentences (${percentage}%)`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          font: {
            size: 11,
            weight: "600" as const,
          },
        },
      },
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
        },
        grid: {
          color: "rgba(0, 0, 0, 0.05)",
        },
      },
    },
  };

  const vocabularyLevel = data.vocabularyRichness >= 0.8 ? "Excellent" :
                         data.vocabularyRichness >= 0.6 ? "Good" :
                         data.vocabularyRichness >= 0.4 ? "Fair" : "Needs Improvement";

  const vocabularyColor = data.vocabularyRichness >= 0.8 ? "text-green-600" :
                         data.vocabularyRichness >= 0.6 ? "text-blue-600" :
                         data.vocabularyRichness >= 0.4 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Vocabulary & Structure</h3>
        <div className="text-sm text-gray-600">
          <span className={`font-semibold ${vocabularyColor}`}>{vocabularyLevel}</span>
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-blue-50 p-3 rounded-lg text-center">
          <div className="font-semibold text-blue-600">{data.sentences}</div>
          <div className="text-blue-700 text-xs">Total Sentences</div>
        </div>
        <div className="bg-green-50 p-3 rounded-lg text-center">
          <div className="font-semibold text-green-600">{data.avgSentenceLength}</div>
          <div className="text-green-700 text-xs">Avg Length</div>
        </div>
        <div className="bg-purple-50 p-3 rounded-lg text-center">
          <div className="font-semibold text-purple-600">{data.uniqueWords}</div>
          <div className="text-purple-700 text-xs">Unique Words</div>
        </div>
        <div className="bg-indigo-50 p-3 rounded-lg text-center">
          <div className="font-semibold text-indigo-600">{(data.vocabularyRichness * 100).toFixed(1)}%</div>
          <div className="text-indigo-700 text-xs">Vocab Richness</div>
        </div>
      </div>
      
      <div className="h-48 w-full">
        <Bar data={chartData} options={options} />
      </div>
      
      <div className="text-xs text-gray-500 text-center space-y-1">
        <div>Ideal sentence distribution: 20% short, 60% normal, 20% long</div>
        <div>Vocabulary richness = unique words / total words</div>
      </div>
    </div>
  );
}
