import { program } from "commander";
import { analyzeTimeline, groupByDate } from "./timeline-analyzer.js";
import { formatAttendance, type OutputFormat } from "./formatter.js";

program
  .name("google-maps-timeline")
  .description("Google Maps Timeline.json を解析して出社日をリストアップ");

program
  .command("attendance")
  .description("当月（または指定月）の出社日一覧を表示")
  .requiredOption("--file <path>", "Timeline.json のパス")
  .option("--month <YYYY-MM>", "対象月（デフォルト: 当月）")
  .option("--lat <number>", "会社の緯度（座標指定時）", parseFloat)
  .option("--lng <number>", "会社の経度（座標指定時）", parseFloat)
  .option("--radius <meters>", "許容半径メートル（デフォルト: 200）", "200")
  .option("--format <type>", "出力形式 (table/json)", "table")
  .action(async (opts) => {
    try {
      // 当月をデフォルトに
      const now = new Date();
      const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const month: string = opts.month ?? defaultMonth;

      const format = opts.format as OutputFormat;
      const radius = parseInt(opts.radius, 10);

      const visits = await analyzeTimeline(opts.file, {
        month,
        workLat: opts.lat,
        workLng: opts.lng,
        radiusMeters: radius,
      });

      const byDate = groupByDate(visits);
      console.log(formatAttendance(byDate, month, format));
    } catch (err: any) {
      console.error(`エラー: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
