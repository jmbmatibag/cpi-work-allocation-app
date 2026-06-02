import { useState, useEffect } from "react";

const DateTimeClock = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const date = now.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const time = now.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <span className="text-sm text-muted-foreground font-medium select-none no-print tabular-nums tracking-tight">
      {date} &bull; {time}
    </span>
  );
};

export default DateTimeClock;
