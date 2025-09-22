"use client";
import { Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

interface DisfluencyChartProps {
  data: Array<{ type: string; count: number }>;
}

export default function DisfluencyChart({ data }: DisfluencyChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 w-full flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-center text-gray-500">
          <div className="text-2xl mb-2">✨</div>
          <p>No disfluencies detected!</p>
          <p className="text-sm">Excellent speech fluency.</p>
        </div>
      </div>
    );
  }

  const colors = [
    "rgba(239, 68, 68, 0.8)",   // Red for repetitions
    "rgba(245, 158, 11, 0.8)",  // Orange for false starts
    "rgba(168, 85, 247, 0.8)",  // Purple for other
    "rgba(59, 130, 246, 0.8)",  // Blue for additional types
  ];

  const borderColors = [
    "rgba(239, 68, 68, 1)",
    "rgba(245, 158, 11, 1)",
    "rgba(168, 85, 247, 1)",
    "rgba(59, 130, 246, 1)",
  ];

  const chartData = {
    labels: data.map(d => d.type),
    datasets: [
      {
        data: data.map(d => d.count),
        backgroundColor: colors.slice(0, data.length),
        borderColor: borderColors.slice(0, data.length),
        borderWidth: 2,
        hoverBorderWidth: 3,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "right" as const,
        labels: {
          padding: 20,
          font: {
            size: 12,
          },
          generateLabels: function(chart: { data: { labels: string[]; datasets: Array<{ data: number[]; backgroundColor: string[]; borderColor: string[]; borderWidth: number }> } }) {
            const data = chart.data;
            if (data.labels.length && data.datasets.length) {
              const total = data.datasets[0].data.reduce((a: number, b: number) => a + b, 0);
              return data.labels.map((label: string, i: number) => {
                const value = data.datasets[0].data[i];
                const percentage = ((value / total) * 100).toFixed(1);
                return {
                  text: `${label}: ${value} (${percentage}%)`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  strokeStyle: data.datasets[0].borderColor[i],
                  lineWidth: data.datasets[0].borderWidth,
                  hidden: false,
                  index: i,
                };
              });
            }
            return [];
          },
        },
      },
      tooltip: {
        callbacks: {
          label: function (context: { dataset: { data: number[] }; parsed: number; label: string }) {
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = ((context.parsed / total) * 100).toFixed(1);
            return `${context.label}: ${context.parsed} (${percentage}%)`;
          },
        },
      },
    },
    cutout: "50%",
  };

  const totalDisfluencies = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Disfluency Breakdown</h3>
        <div className="text-sm text-gray-600">
          Total: <span className="font-semibold text-orange-600">{totalDisfluencies}</span> disfluencies
        </div>
      </div>
      
      <div className="h-64 w-full">
        <Doughnut data={chartData} options={options} />
      </div>
      
      <div className="text-xs text-gray-500 text-center">
        Disfluencies include repetitions, false starts, and other speech interruptions
      </div>
    </div>
  );
}
