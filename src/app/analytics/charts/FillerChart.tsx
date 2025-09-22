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

interface FillerChartProps {
  data: Array<{ word: string; count: number }>;
}

export default function FillerChart({ data }: FillerChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 w-full flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-center text-gray-500">
          <div className="text-2xl mb-2">🎉</div>
          <p>No filler words detected!</p>
          <p className="text-sm">Great job maintaining clean speech.</p>
        </div>
      </div>
    );
  }

  const labels = data.map((d) => d.word);
  const counts = data.map((d) => d.count);
  
  // Color gradient based on frequency
  const colors = counts.map((count) => {
    const maxCount = Math.max(...counts);
    const intensity = count / maxCount;
    return `rgba(239, 68, 68, ${0.3 + intensity * 0.5})`; // Red gradient
  });

  const chartData = {
    labels,
    datasets: [
      {
        label: "Frequency",
        data: counts,
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace(/0\.\d+\)$/, '1)')),
        borderWidth: 1,
        borderRadius: 4,
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
            const total = counts.reduce((a, b) => a + b, 0);
            const percentage = ((context.parsed.y / total) * 100).toFixed(1);
            return `${context.parsed.y} times (${percentage}%)`;
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

  const totalFillers = counts.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Filler Words Analysis</h3>
        <div className="text-sm text-gray-600">
          Total: <span className="font-semibold text-red-600">{totalFillers}</span> filler words
        </div>
      </div>
      <div className="h-64 w-full">
        <Bar data={chartData} options={options} />
      </div>
      <div className="text-xs text-gray-500 text-center">
        Tip: Reducing filler words by 50% can significantly improve speech clarity
      </div>
    </div>
  );
}