import React from 'react';
import type { FermentationDataPoint } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface FermentationChartProps {
    data: FermentationDataPoint[];
}

export const FermentationChart: React.FC<FermentationChartProps> = ({ data }) => {
    if (data.length < 2) {
        return (
            <div className="flex items-center justify-center h-full w-full bg-slate-800 rounded-md text-slate-400 text-xs px-4 text-center">
                Dati insufficienti per il grafico (inserisci almeno 2 misurazioni giornaliere).
            </div>
        );
    }

    const hasPh = data.some(d => d.PH !== undefined && !isNaN(d.PH));

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 16, left: -10, bottom: 4 }}>
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
                    label={{ value: 'Plato / pH', angle: 90, position: 'insideRight', fill: '#3b82f6', fontSize: 11 }}
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
                <Legend wrapperStyle={{ fontSize: '11px' }} />
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
    );
};