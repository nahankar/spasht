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

interface SpeechTimingChartProps {
  data: {
    totalDuration: number;
    talkTime: number;
    pauseTime: number;
    avgTurnLength: number;
    turnCount: number;
  };
}

export default function SpeechTimingChart({ data }: SpeechTimingChartProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const talkPercentage = data.totalDuration > 0 ? (data.talkTime / data.totalDuration) * 100 : 0;
  const pausePercentage = 100 - talkPercentage;

  const chartData = {
    labels: ["Talk Time", "Pause Time"],
    datasets: [
      {
        label: "Time Distribution",
        data: [data.talkTime, data.pauseTime],
        backgroundColor: [
          "rgba(16, 185, 129, 0.8)",  // Green for talk time
          "rgba(156, 163, 175, 0.8)",  // Gray for pause time
        ],
        borderColor: [
          "rgba(16, 185, 129, 1)",
          "rgba(156, 163, 175, 1)",
        ],
        borderWidth: 2,
        borderRadius: 8,
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
          label: function (context: { dataIndex: number; label: string; parsed: { y: number } }) {
            const percentage = context.dataIndex === 0 ? talkPercentage : pausePercentage;
            return `${context.label}: ${formatTime(context.parsed.y)} (${percentage.toFixed(1)}%)`;
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
        grid: {
          color: "rgba(0, 0, 0, 0.05)",
        },
        ticks: {
          callback: function (value: number | string) {
            return formatTime(Number(value));
          },
        },
      },
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Speech Timing Analysis</h3>
        <div className="text-sm text-gray-600">
          Total: <span className="font-semibold">{formatTime(data.totalDuration)}</span>
        </div>
      </div>
      
      <div className="h-48 w-full">
        <Bar data={chartData} options={options} />
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="bg-green-50 p-3 rounded-lg text-center">
          <div className="font-semibold text-green-600">{talkPercentage.toFixed(1)}%</div>
          <div className="text-green-700 text-xs">Talk Time</div>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg text-center">
          <div className="font-semibold text-gray-600">{pausePercentage.toFixed(1)}%</div>
          <div className="text-gray-700 text-xs">Pause Time</div>
        </div>
        <div className="bg-blue-50 p-3 rounded-lg text-center">
          <div className="font-semibold text-blue-600">{data.turnCount}</div>
          <div className="text-blue-700 text-xs">Total Turns</div>
        </div>
        <div className="bg-purple-50 p-3 rounded-lg text-center">
          <div className="font-semibold text-purple-600">{data.avgTurnLength.toFixed(1)}s</div>
          <div className="text-purple-700 text-xs">Avg Turn</div>
        </div>
      </div>
      
      <div className="text-xs text-gray-500 text-center">
        Optimal talk time ratio is typically 60-80% for engaging conversations
      </div>
    </div>
  );
}
