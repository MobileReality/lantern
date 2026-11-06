const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SPARK_PADDING = 1.5;
const SPARK_MIN_SPAN_RATIO = 0.05;

export function formatBytes(bytes: number) {
  if (bytes >= 10 * GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  return `${Math.max(0, Math.round(bytes / KB))} KB`;
}

export function formatInstalled(bytes: number) {
  return `${Math.round(bytes / GB)} GB`;
}

export function formatAge(seconds: number) {
  if (seconds < SECONDS_PER_MINUTE) return `${Math.max(0, Math.floor(seconds))}s`;
  if (seconds < SECONDS_PER_HOUR) return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m`;
  if (seconds < SECONDS_PER_DAY) return `${Math.floor(seconds / SECONDS_PER_HOUR)}h ${Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)}m`;
  return `${Math.floor(seconds / SECONDS_PER_DAY)}d ${Math.floor((seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR)}h`;
}

export function formatShare(part: number, whole: number) {
  if (whole <= 0) return '0%';
  const percent = (part / whole) * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

export function sparklinePoints(series: number[], width: number, height: number) {
  if (series.length < 2) return '';
  const low = Math.min(...series);
  const high = Math.max(...series);
  const middle = (low + high) / 2;
  const span = Math.max(high - low, high * SPARK_MIN_SPAN_RATIO) || 1;
  const step = (width - 2 * SPARK_PADDING) / (series.length - 1);
  const usable = height - 2 * SPARK_PADDING;
  return series
    .map((value, index) => {
      const level = 0.5 + (value - middle) / span;
      return `${(SPARK_PADDING + index * step).toFixed(1)},${(SPARK_PADDING + (1 - level) * usable).toFixed(1)}`;
    })
    .join(' ');
}
