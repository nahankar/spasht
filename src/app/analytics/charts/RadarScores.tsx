"use client";
import { Radar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

interface RadarScoresProps {
  data: {
    overall: number;
    fluency: number;
    clarity: number;
    confidence: number;
    paceScore: number;
    vocabularyScore: number;
  };
}

export default function RadarScores({ data }: RadarScoresProps) {
  const chartData = {
    labels: ["Fluency", "Clarity", "Confidence", "Pace", "Vocabulary", "Overall"],
    datasets: [
      {
        label: "Speech Scores",
        data: [
          data.fluency || 0,
          data.clarity || 0,
          data.confidence || 0,
          data.paceScore || 0,
          data.vocabularyScore || 0,
          data.overall || 0,
        ],
        backgroundColor: "rgba(59, 130, 246, 0.2)",
        borderColor: "rgba(59, 130, 246, 1)",
        borderWidth: 2,
        pointBackgroundColor: "rgba(59, 130, 246, 1)",
        pointBorderColor: "#fff",
        pointHoverBackgroundColor: "#fff",
        pointHoverBorderColor: "rgba(59, 130, 246, 1)",
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
          label: function (context: { label: string; parsed: { r: number } }) {
            return `${context.label}: ${context.parsed.r}/100`;
          },
        },
      },
    },
    scales: {
      r: {
        beginAtZero: true,
        max: 100,
        ticks: {
          stepSize: 20,
          font: {
            size: 10,
          },
        },
        grid: {
          color: "rgba(0, 0, 0, 0.1)",
        },
        angleLines: {
          color: "rgba(0, 0, 0, 0.1)",
        },
        pointLabels: {
          font: {
            size: 12,
            weight: "600" as const,
          },
          color: "#374151",
        },
      },
    },
  };

  return (
    <div className="h-80 w-full">
      <Radar data={chartData} options={options} />
    </div>
  );
}
