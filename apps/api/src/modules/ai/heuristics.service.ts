import { Injectable, Logger } from '@nestjs/common';

const KEYWORDS: RegExp[] = [
  /\bhay que\b/i,
  /\bten[ée]s que\b/i,
  /\btenemos que\b/i,
  /\bhay\s+que\b/i,
  /\bdeber[íi]a(?:s|mos)?\b/i,
  /\bpod[ée]s\b/i,
  /\bpodr[íi]as?\b/i,
  /\bnecesito\b/i,
  /\bnecesitamos\b/i,
  /\bme falta\b/i,
  /\bqueda pendiente\b/i,
  /\bpor favor\b/i,
  /\bporfa(?:vor|s|i)?\b/i,
  /\bme avis[áa]s\b/i,
  /\bav[íi]same\b/i,
  /\brecord[áa]\b/i,
  /\bacord[áa](?:te)?\b/i,
  /\bconfirm(?:ar|amos|á|a)\b/i,
  /\bcoordinar\b/i,
  /\borganizar\b/i,
  /\bentregar\b/i,
  /\bcomprar\b/i,
  /\bllevar\b/i,
  /\btraer\b/i,
  /\bpreparar\b/i,
  /\breservar\b/i,
  /\bllamar\b/i,
  /\benviar\b/i,
  /\bmandar\b/i,
  /\bagendar\b/i,
  /\bcontactar\b/i,
  /\barmar\b/i,
];

const DATE_HINTS: RegExp[] = [
  /\b(hoy|mañana|pasado mañana|anteayer)\b/i,
  /\b(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)\b/i,
  /\bla\s+semana\s+que\s+viene\b/i,
  /\bla\s+pr[óo]xima\s+semana\b/i,
  /\bel\s+pr[óo]ximo\s+\w+/i,
  /\bantes del?\b/i,
  /\bpara el?\b/i,
  /\ba las?\s+\d{1,2}/i,
  /\b\d{1,2}\s+de\s+\w+/i,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i,
];

const URL_RE = /https?:\/\/\S+/g;
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/gu;

export interface HeuristicDecision {
  enqueue: boolean;
  reason: string;
}

interface HeuristicCounters {
  total: number;
  notGroup: number;
  tooShort: number;
  noText: number;
  noSignal: number;
  enqueued: number;
}

const FLUSH_EVERY = 50;

@Injectable()
export class HeuristicsService {
  private readonly logger = new Logger(HeuristicsService.name);
  private counters: HeuristicCounters = {
    total: 0,
    notGroup: 0,
    tooShort: 0,
    noText: 0,
    noSignal: 0,
    enqueued: 0,
  };

  evaluate(text: string | null | undefined, jid: string): HeuristicDecision {
    this.counters.total += 1;
    this.maybeFlush();

    if (!jid.endsWith('@g.us')) {
      this.counters.notGroup += 1;
      return { enqueue: false, reason: 'not_group' };
    }

    const cleaned = (text ?? '')
      .replace(URL_RE, ' ')
      .replace(EMOJI_RE, ' ')
      .trim();

    if (cleaned.length === 0) {
      this.counters.noText += 1;
      return { enqueue: false, reason: 'no_text' };
    }

    const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
    if (words.length < 4) {
      this.counters.tooShort += 1;
      return { enqueue: false, reason: 'too_short' };
    }

    const matchesKeyword = KEYWORDS.some((re) => re.test(cleaned));
    const matchesDate = DATE_HINTS.some((re) => re.test(cleaned));

    if (!matchesKeyword && !matchesDate) {
      this.counters.noSignal += 1;
      return { enqueue: false, reason: 'no_signal' };
    }

    this.counters.enqueued += 1;
    const signal = matchesKeyword && matchesDate
      ? 'keyword+date'
      : matchesKeyword
        ? 'keyword'
        : 'date';
    return { enqueue: true, reason: signal };
  }

  snapshot(): HeuristicCounters {
    return { ...this.counters };
  }

  private maybeFlush() {
    if (this.counters.total === 0 || this.counters.total % FLUSH_EVERY !== 0) {
      return;
    }
    const c = this.counters;
    const skipped = c.notGroup + c.tooShort + c.noText + c.noSignal;
    const skipPct = ((skipped / c.total) * 100).toFixed(1);
    const enqPct = ((c.enqueued / c.total) * 100).toFixed(1);
    this.logger.log(
      `[metrics] in=${c.total} skip=${skipped} (${skipPct}%) ` +
        `[not_group=${c.notGroup} short=${c.tooShort} no_text=${c.noText} no_signal=${c.noSignal}] ` +
        `enqueued=${c.enqueued} (${enqPct}%)`,
    );
  }
}
