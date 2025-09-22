"use client";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface PaceTrendProps {
  data: Array<{ 
    turnIndex: number;
    wordCount: number;
    duration: number;
    pace: number;
    fillerCount: number;
    timestamp: string;
  }>;
}

export default function PaceTrend({ data }: PaceTrendProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 w-full flex items-center justify-center bg-gray-50 rounded-lg">
        <div className="text-center text-gray-500">
          <div className="text-2xl mb-2">📊</div>
          <p>No turn data available</p>
          <p className="text-sm">Pace analysis requires conversation turns.</p>
        </div>
      </div>
    );
  }

  const labels = data.map((d, i) => `Turn ${i + 1}`);
  const paceData = data.map((d) => d.pace);
  const avgPace = paceData.reduce((a, b) => a + b, 0) / paceData.length;
  
  // Ideal pace range (120-160 WPM)
  const idealMin = 120;
  const idealMax = 160;

  const chartData = {
    labels,
    datasets: [
      {
        label: "Speaking Pace (WPM)",
        data: paceData,
        borderColor: "rgba(16, 185, 129, 1)",
        backgroundColor: "rgba(16, 185, 129, 0.1)",
        borderWidth: 3,
        pointBackgroundColor: paceData.map(pace => {
          if (pace >= idealMin && pace <= idealMax) return "rgba(16, 185, 129, 1)";
          if (pace < idealMin) return "rgba(239, 68, 68, 1)";
          return "rgba(245, 158, 11, 1)";
        }),
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8,
        tension: 0.3,
        fill: true,
      },
      {
        label: "Average Pace",
        data: Array(data.length).fill(avgPace),
        borderColor: "rgba(107, 114, 128, 0.5)",
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 0,
        pointHoverRadius: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          font: {
            size: 12,
          },
        },
      },
      tooltip: {
        callbacks: {
          label: function (context: { datasetIndex: number; dataIndex: number; parsed: { y: number } }) {
            if (context.datasetIndex === 0) {
              const turn = data[context.dataIndex];
              return [
                `Pace: ${context.parsed.y} WPM`,
                `Words: ${turn.wordCount}`,
                `Duration: ${turn.duration}s`,
                `Fillers: ${turn.fillerCount}`,
              ];
            }
            return `Average: ${context.parsed.y.toFixed(1)} WPM`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: "rgba(0, 0, 0, 0.05)",
        },
        ticks: {
          font: {
            size: 11,
          },
        },
      },
      y: {
        beginAtZero: false,
        min: Math.max(0, Math.min(...paceData) - 20),
        max: Math.max(...paceData) + 20,
        grid: {
          color: "rgba(0, 0, 0, 0.05)",
        },
        ticks: {
          callback: function (value: number | string) {
            return value + " WPM";
          },
        },
      },
    },
    elements: {
      point: {
        hoverBorderWidth: 3,
      },
    },
  };

  const slowTurns = data.filter(d => d.pace < idealMin).length;
  const fastTurns = data.filter(d => d.pace > idealMax).length;
  const idealTurns = data.length - slowTurns - fastTurns;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Speaking Pace Trend</h3>
        <div className="text-sm text-gray-600">
          Avg: <span className="font-semibold">{avgPace.toFixed(1)} WPM</span>
        </div>
      </div>
      
      <div className="h-64 w-full">
        <Line data={chartData} options={options} />
      </div>
      
      <div className="grid grid-cols-3 gap-4 text-center text-sm">
        <div className="p-2 bg-red-50 rounded">
          <div className="font-semibold text-red-600">{slowTurns}</div>
          <div className="text-red-700">Too Slow (&lt;120)</div>
        </div>
        <div className="p-2 bg-green-50 rounded">
          <div className="font-semibold text-green-600">{idealTurns}</div>
          <div className="text-green-700">Ideal (120-160)</div>
        </div>
        <div className="p-2 bg-yellow-50 rounded">
          <div className="font-semibold text-yellow-600">{fastTurns}</div>
          <div className="text-yellow-700">Too Fast (&gt;160)</div>
        </div>
      </div>
    </div>
  );
}