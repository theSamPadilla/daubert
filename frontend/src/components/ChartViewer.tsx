'use client';

import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend,
);

interface ChartData {
  chartType: string;
  datasets: any[];
  labels: string[];
  options?: Record<string, unknown>;
}

interface ChartViewerProps {
  data: ChartData;
}

export function ChartViewer({ data }: ChartViewerProps) {
  if (!Array.isArray(data.datasets) || !Array.isArray(data.labels)) {
    return <div className="text-red-400 text-sm">Invalid chart data: datasets and labels must be arrays.</div>;
  }
  const chartData = { labels: data.labels, datasets: data.datasets };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    ...data.options,
    plugins: {
      legend: { labels: { color: '#d1d5db' } },
      ...(data.options?.plugins as any),
    },
    scales: {
      x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
      y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
      ...(data.options?.scales as any),
    },
  };

  switch (data.chartType) {
    case 'bar': return <div className="h-96"><Bar data={chartData} options={options} /></div>;
    case 'line': return <div className="h-96"><Line data={chartData} options={options} /></div>;
    case 'pie': return <div className="h-96"><Pie data={chartData} options={options} /></div>;
    case 'doughnut': return <div className="h-96"><Doughnut data={chartData} options={options} /></div>;
    default: return <div className="text-gray-400">Unsupported chart type: {data.chartType}</div>;
  }
}
