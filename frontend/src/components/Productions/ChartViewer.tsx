'use client';

import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';
import { applyBrandColors, getBrandChartOptions } from '@/lib/chartPalette';
import type { ExportTheme } from '@/lib/exportTheme';

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, ArcElement,
  Title, Tooltip, Legend,
  annotationPlugin,
);

interface ChartData {
  chartType: string;
  datasets: any[];
  labels: string[];
  options?: Record<string, unknown>;
}

interface ChartViewerProps {
  data: ChartData;
  theme?: ExportTheme;
}

export function ChartViewer({ data, theme = 'dark' }: ChartViewerProps) {
  if (!Array.isArray(data.datasets) || !Array.isArray(data.labels)) {
    return <div className="text-red-400 text-sm">Invalid chart data: datasets and labels must be arrays.</div>;
  }
  const chartData = {
    labels: data.labels,
    datasets: applyBrandColors(data.datasets),
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    ...data.options,
    plugins: {
      ...getBrandChartOptions(theme).plugins,
      ...(data.options?.plugins as any),
    },
    scales: {
      ...getBrandChartOptions(theme).scales,
      ...(data.options?.scales as any),
    },
  };

  switch (data.chartType) {
    case 'bar': return <div className="h-full"><Bar data={chartData} options={options} /></div>;
    case 'line': return <div className="h-full"><Line data={chartData} options={options} /></div>;
    case 'pie': return <div className="h-full"><Pie data={chartData} options={options} /></div>;
    case 'doughnut': return <div className="h-full"><Doughnut data={chartData} options={options} /></div>;
    default: return <div className="text-ink-faint">Unsupported chart type: {data.chartType}</div>;
  }
}
