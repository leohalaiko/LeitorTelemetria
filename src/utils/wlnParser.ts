export interface WlnRecord {
    timestamp: number;
    dataIso: string;
    latitude: number;
    longitude: number;
    // Permite campos dinâmicos como 'upar16', 'i/o', etc.
    [key: string]: string | number;
}

export const parseWlnContent = (content: string): WlnRecord[] => {
    const records: WlnRecord[] = [];
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmedLine = line.trim();

        if (!trimmedLine || !trimmedLine.startsWith("REG;")) {
            continue;
        }

        const parts = trimmedLine.split(';');

        try {
            const timestampSeconds = parseInt(parts[1]);
            const timestampMs = timestampSeconds * 1000;

            if (isNaN(timestampMs)) continue;

            const baseRecord: WlnRecord = {
                timestamp: timestampMs,
                dataIso: new Date(timestampMs).toISOString(),
                latitude: parseFloat(parts[2]),
                longitude: parseFloat(parts[3]),
            };

            parts.forEach((part) => {
                const subItems = part.split(',');

                subItems.forEach((item) => {
                    // Agora suporta tanto "upar0:123" quanto "I/O=13/e"
                    const separator = item.includes('=') ? '=' : (item.includes(':') ? ':' : null);

                    if (separator) {
                        let [key, val] = item.split(separator);

                        if (key && val) {
                            key = key.trim().toLowerCase();
                            val = val.replace(/"/g, '').trim();

                            // BUG CORRIGIDO: Number() garante que "13/e" não perca a letra 'e'
                            const numVal = Number(val);

                            if (!isNaN(numVal) && val !== '') {
                                baseRecord[key] = numVal;
                            } else {
                                baseRecord[key] = val;
                            }
                        }
                    }
                });
            });

            records.push(baseRecord);

        } catch (error) {
            console.error("Erro ao processar linha WLN:", trimmedLine, error);
        }
    }

    return records;
};