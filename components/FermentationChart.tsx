import React, { useMemo } from 'react';
import type { FermentationDataPoint } from '../types';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    ReferenceLine,
} from 'recharts';
import {
    calculateBrewMetrics,
    ABV_TOLERANCE_PERCENT,
} from '../utils/brewingCalculations';

interface FermentationChartProps {
    data: FermentationDataPoint[];
    ogPlato?: number | string;
    targetAbv?: number | null;
    refermentationAbv?: number;
    carbonationMode?: 'ISOBARICO' | 'RIFERMENTATO';
    effectiveTotalAbv?: number | null;
    isAbvOutOfTolerance?: boolean;
}

export const FermentationChart: React.FC<FermentationChartProps> = ({
    data,
    ogPlato,
    targetAbv,
    refermentationAbv = 0,
    carbonationMode = 'ISOBARICO',
    effectiveTotalAbv,
    isAbvOutOfTolerance = false,
}) => {
    const chartData = useMemo(() => {
        return data.map(d => {
            const metrics = calculateBrewMetrics(ogPlato, d.PLATO);
            const abvPrimary = metrics ? Number(metrics.abv.toFixed(2)) : undefined;
            const abvTotal =
                abvPrimary !== undefined
                    ? Number((abvPrimary + (carbonationMode === 'RIFERMENTATO' ? refermentationAbv : 0)).toFixed(2))
                    : undefined;
            return {
                ...d,
                ABV_PRIMARIO: abvPrimary,
                ABV_STIMATO: abvTotal,
            };
        });
    }, [data, ogPlato, refermentationAbv, carbonationMode]);

    const hasPh = chartData.some(d => d.PH !== undefined && !isNaN(d.PH));
    const hasAbvCurve = chartData.some(d => d.ABV_STIMATO !== undefined);
    const hasValidTarget = typeof targetAbv === 'number' && !isNaN(targetAbv) && targetAbv > 0;
    const diff =
        hasValidTarget && typeof effectiveTotalAbv === 'number' && !isNaN(effectiveTotalAbv)
            ? effectiveTotalAbv - targetAbv
            : null;

    return (
        <div className={`flex flex-col h-full w-full rounded-md ${isAbvOutOfTolerance ? 'ring-2 ring-red-500 animate-pulse' : ''}`}>
            {(hasValidTarget || typeof effectiveTotalAbv === 'number') && (
                <div
                    className={`flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-t-md text-[11px] font-mono tabular-nums border-b ${
                        isAbvOutOfTolerance
                            ? 'bg-red-900/70 border-red-500 text-red-100'
                            : 'bg-slate-900/80 border-slate-700 text-slate-200'
                    }`}
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <span>
                            Target Etichetta:{' '}
                            <strong className="text-amber-300">
                                {hasValidTarget ? `${targetAbv!.toFixed(2)}%` : 'N/D'}
                            </strong>
                        </span>
                        {typeof effectiveTotalAbv === 'number' && !isNaN(effectiveTotalAbv) && (
                            <span>
                                | Reale {carbonationMode === 'RIFERMENTATO' ? '(Prim.+Rif.)' : '(Isobarico)'}:{' '}
                                <strong className={isAbvOutOfTolerance ? 'text-red-300' : 'text-emerald-300'}>
                                    {effectiveTotalAbv.toFixed(2)}%
                                </strong>
                            </span>
                        )}
                    </div>
                    {isAbvOutOfTolerance && diff !== null ? (
                        <span className="font-sans font-extrabold text-red-200">
                            🚨 ALLARME ABV ±{ABV_TOLERANCE_PERCENT}% ({diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}%)
                        </span>
                    ) : diff !== null ? (
                        <span className="font-sans font-bold text-emerald-300">
                            ✅ In target ({diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}%)
                        </span>
                    ) : null}
                </div>
            )}

            <div className="flex-1 min-h-[165px]">
                {chartData.length < 2 ? (
                    <div className="flex items-center justify-center h-full w-full bg-slate-800 rounded-b-md text-slate-400 text-xs px-4 text-center">
                        Dati insufficienti per il grafico (inserisci almeno 2 misurazioni giornaliere).
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 8, right: 16, left: -10, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                            <XAxis
                                dataKey="GIORNO"
                                stroke="#94a3b8"
                                tick={{ fontSize: 11 }}
                                label={{ value: 'Giorno', position: 'insideBottom', offset: -4, fill: '#94a3b8', fontSize: 11 }}
                            />
                            <YAxis
                                yAxisId="left"
                                stroke="#ef4444"
                                tick={{ fontSize: 11 }}
                                label={{ value: 'Temp (°C)', angle: -90, position: 'insideLeft', fill: '#ef4444', fontSize: 11 }}
                            />
                            <YAxis
                                yAxisId="right"
                                orientation="right"
                                stroke="#3b82f6"
                                tick={{ fontSize: 11 }}
                                label={{ value: 'Plato / ABV%', angle: 90, position: 'insideRight', fill: '#3b82f6', fontSize: 11 }}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#0f172a',
                                    borderColor: '#475569',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                }}
                                formatter={(value: number, name: string) => [
                                    typeof value === 'number' ? value.toFixed(2) : value,
                                    name,
                                ]}
                                labelFormatter={(day) => `Giorno ${day}`}
                            />
                            <Legend wrapperStyle={{ fontSize: '10px' }} />
                            {hasValidTarget && (
                                <ReferenceLine
                                    yAxisId="right"
                                    y={targetAbv!}
                                    stroke="#f59e0b"
                                    strokeDasharray="6 3"
                                    strokeWidth={1.5}
                                    label={{
                                        value: `Target ${targetAbv!.toFixed(1)}%`,
                                        fill: '#fbbf24',
                                        fontSize: 10,
                                        position: 'insideTopRight',
                                    }}
                                />
                            )}
                            <Line
                                yAxisId="left"
                                type="monotone"
                                dataKey="TEMPERATURA"
                                stroke="#ef4444"
                                strokeWidth={2}
                                name="Temp (°C)"
                                dot={{ r: 3 }}
                                activeDot={{ r: 5 }}
                            />
                            <Line
                                yAxisId="right"
                                type="monotone"
                                dataKey="PLATO"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                name="Plato (°P)"
                                dot={{ r: 3 }}
                                activeDot={{ r: 5 }}
                            />
                            {hasAbvCurve && (
                                <Line
                                    yAxisId="right"
                                    type="monotone"
                                    dataKey="ABV_STIMATO"
                                    stroke="#f59e0b"
                                    strokeWidth={2}
                                    name={carbonationMode === 'RIFERMENTATO' ? 'ABV Tot. (%)' : 'ABV (%)'}
                                    dot={{ r: 2.5 }}
                                    connectNulls
                                />
                            )}
                            {hasPh && (
                                <Line
                                    yAxisId="right"
                                    type="monotone"
                                    dataKey="PH"
                                    stroke="#10b981"
                                    strokeWidth={1.75}
                                    strokeDasharray="4 2"
                                    name="pH"
                                    dot={{ r: 2.5 }}
                                    connectNulls
                                />
                            )}
                        </LineChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
};