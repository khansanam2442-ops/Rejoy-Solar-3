import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { storageService } from '../../services/storage';
import { AttendanceRecord } from '../../types/solar';
import {
  Play,
  Square,
  CheckCircle2,
  MapPin,
  Clock,
  Sparkles,
  AlertCircle,
  RotateCcw,
  ArrowRight,
  Sun,
  ShieldCheck,
  Check
} from 'lucide-react';

interface TodayAttendanceCardProps {
  className?: string;
  onPunchSuccess?: (type: 'CHECK_IN' | 'CHECK_OUT', record: AttendanceRecord) => void;
}

// Helper to compute duration string like "8h 15m" or "45m"
function calculateWorkDuration(
  checkInTimeStr: string,
  checkOutTimeStr?: string,
  dateStr?: string
): { text: string; hours: number } {
  try {
    const today = dateStr || new Date().toISOString().slice(0, 10);

    const parseTime = (timeStr: string): Date => {
      const d = new Date(`${today}T00:00:00`);
      const match = timeStr.match(/(\d+):(\d+)(?:\s*(AM|PM))?/i);
      if (!match) return new Date();
      let hour = parseInt(match[1], 10);
      const min = parseInt(match[2], 10);
      const ampm = match[3] ? match[3].toUpperCase() : null;
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      d.setHours(hour, min, 0, 0);
      return d;
    };

    const inDate = parseTime(checkInTimeStr);
    const outDate = checkOutTimeStr ? parseTime(checkOutTimeStr) : new Date();

    let diffMs = outDate.getTime() - inDate.getTime();
    if (diffMs < 0) diffMs = Math.abs(diffMs);

    const totalMinutes = Math.max(1, Math.round(diffMs / (1000 * 60)));
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    let text = '';
    if (hours === 0) {
      text = `${mins}m`;
    } else if (mins === 0) {
      text = `${hours}h`;
    } else {
      text = `${hours}h ${mins}m`;
    }

    const decimalHours = parseFloat((totalMinutes / 60).toFixed(2));
    return { text, hours: decimalHours };
  } catch (_e) {
    return { text: '8h 00m', hours: 8 };
  }
}

export const TodayAttendanceCard: React.FC<TodayAttendanceCardProps> = ({
  className = '',
  onPunchSuccess
}) => {
  const { currentUser, currentRole } = useAuth();
  const { triggerRefresh, showToast, refreshTrigger } = useApp();

  // Strictly do not show on Admin Dashboard or for Admin users
  if (currentRole === 'Admin' || currentUser?.role === 'Admin') {
    return null;
  }

  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'IN' | 'OUT' | null>(null);
  const [currentTimeText, setCurrentTimeText] = useState('');

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Formatted date string for humans
  const todayReadable = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });
  }, []);

  // Fetch today's record for this user from storage
  const attendanceList = useMemo(() => {
    return storageService.getAttendance();
  }, [refreshTrigger]);

  const todayRecord = useMemo(() => {
    const userId = currentUser?.id;
    const userName = currentUser?.name;
    return attendanceList.find(
      a => (a.employeeId === userId || a.employeeName === userName) && a.date === todayStr
    ) || null;
  }, [attendanceList, currentUser, todayStr]);

  // Derived state:
  // 1. 'NOT_STARTED': no check-in today
  // 2. 'WORKING': checked in, but not checked out
  // 3. 'COMPLETED': checked out today
  const attendanceState: 'NOT_STARTED' | 'WORKING' | 'COMPLETED' = useMemo(() => {
    if (!todayRecord || !todayRecord.checkInTime) {
      return 'NOT_STARTED';
    }
    if (todayRecord.checkInTime && !todayRecord.checkOutTime) {
      return 'WORKING';
    }
    return 'COMPLETED';
  }, [todayRecord]);

  // Live elapsed time ticker when in 'WORKING' state
  const [elapsedDurationText, setElapsedDurationText] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeText(
        now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
      );

      if (attendanceState === 'WORKING' && todayRecord?.checkInTime) {
        const { text } = calculateWorkDuration(todayRecord.checkInTime, undefined, todayStr);
        setElapsedDurationText(text);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, [attendanceState, todayRecord, todayStr]);

  // Geolocation acquisition handler
  const acquireLocation = useCallback(async (): Promise<{
    latitude: number;
    longitude: number;
    locationName: string;
  }> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        // Fallback site fix if browser does not support geolocation
        resolve({
          latitude: 22.9868,
          longitude: 72.3789,
          locationName: 'Central Solar EPC Site (GPS Simulated Fix)'
        });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        position => {
          const lat = parseFloat(position.coords.latitude.toFixed(5));
          const lng = parseFloat(position.coords.longitude.toFixed(5));
          resolve({
            latitude: lat,
            longitude: lng,
            locationName: `Site Lat: ${position.coords.latitude.toFixed(4)}°, Lng: ${position.coords.longitude.toFixed(4)}°`
          });
        },
        error => {
          console.warn('Geolocation capture notice:', error.message);
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 9000,
          maximumAge: 30000
        }
      );
    });
  }, []);

  // Trigger Punch In
  const handleStartWork = async (useFallbackCoordinates = false) => {
    if (attendanceState !== 'NOT_STARTED') return; // Prevent duplicate punches

    setIsLocating(true);
    setLocationError(null);
    setPendingAction('IN');

    try {
      let gpsCoords = {
        latitude: 22.9868,
        longitude: 72.3789,
        locationName: 'Ahmedabad Solar Operations Hub'
      };

      if (!useFallbackCoordinates) {
        try {
          gpsCoords = await acquireLocation();
        } catch (_err) {
          setIsLocating(false);
          setLocationError(
            'We couldn’t find your location. Please turn on your device GPS or grant location permission.'
          );
          return;
        }
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

      const newRecord: AttendanceRecord = {
        id: `att-${Date.now()}`,
        employeeId: currentUser?.id || 'emp-user',
        employeeName: currentUser?.name || 'Solar Team Member',
        date: todayStr,
        checkInTime: timeStr,
        checkInGps: `${gpsCoords.latitude}, ${gpsCoords.longitude}`,
        gpsCheckIn: {
          latitude: gpsCoords.latitude,
          longitude: gpsCoords.longitude,
          locationName: gpsCoords.locationName
        },
        siteLocation: gpsCoords.locationName || 'Live GPS Punch In',
        status: 'PRESENT'
      };

      storageService.saveAttendanceRecord(newRecord);
      triggerRefresh();
      setIsLocating(false);
      setLocationError(null);
      setPendingAction(null);

      showToast(`Started work at ${timeStr}! Have a safe & productive shift. 🚀`, 'success');
      if (onPunchSuccess) onPunchSuccess('CHECK_IN', newRecord);
    } catch (err: any) {
      setIsLocating(false);
      setLocationError('Unable to record start time. Please try again.');
    }
  };

  // Trigger Punch Out
  const handleFinishWork = async (useFallbackCoordinates = false) => {
    if (attendanceState !== 'WORKING' || !todayRecord) return; // Prevent duplicate or invalid punches

    setIsLocating(true);
    setLocationError(null);
    setPendingAction('OUT');

    try {
      let gpsCoords = {
        latitude: 22.9868,
        longitude: 72.3789,
        locationName: 'Ahmedabad Solar Operations Hub'
      };

      if (!useFallbackCoordinates) {
        try {
          gpsCoords = await acquireLocation();
        } catch (_err) {
          setIsLocating(false);
          setLocationError(
            'We couldn’t find your location. Please turn on your device GPS or grant location permission.'
          );
          return;
        }
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

      const { text: durationText, hours: decimalHours } = calculateWorkDuration(
        todayRecord.checkInTime,
        timeStr,
        todayStr
      );

      const updatedRecord: AttendanceRecord = {
        ...todayRecord,
        checkOutTime: timeStr,
        checkOutGps: `${gpsCoords.latitude}, ${gpsCoords.longitude}`,
        gpsCheckOut: {
          latitude: gpsCoords.latitude,
          longitude: gpsCoords.longitude,
          locationName: gpsCoords.locationName
        },
        totalHours: decimalHours,
        totalDurationText: durationText
      };

      storageService.saveAttendanceRecord(updatedRecord);
      triggerRefresh();
      setIsLocating(false);
      setLocationError(null);
      setPendingAction(null);

      showToast(`All done! You worked ${durationText} 🎉`, 'success');
      if (onPunchSuccess) onPunchSuccess('CHECK_OUT', updatedRecord);
    } catch (_err) {
      setIsLocating(false);
      setLocationError('Unable to record finish time. Please try again.');
    }
  };

  // Work completed duration for display in state 3
  const finalDurationText = useMemo(() => {
    if (!todayRecord || !todayRecord.checkInTime || !todayRecord.checkOutTime) return '8h 00m';
    if (todayRecord.totalDurationText) return todayRecord.totalDurationText;
    const { text } = calculateWorkDuration(
      todayRecord.checkInTime,
      todayRecord.checkOutTime,
      todayRecord.date
    );
    return text;
  }, [todayRecord]);

  return (
    <div
      className={`bg-white rounded-3xl p-5 sm:p-7 border-2 border-slate-200/90 shadow-sm transition-all relative overflow-hidden ${className}`}
    >
      {/* Decorative top accent line */}
      <div
        className={`absolute top-0 left-0 right-0 h-2 ${
          attendanceState === 'NOT_STARTED'
            ? 'bg-emerald-500'
            : attendanceState === 'WORKING'
            ? 'bg-amber-500'
            : 'bg-emerald-600'
        }`}
      />

      {/* Header section with identity and current date */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <Sun className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                Today's Attendance
              </h2>
              <p className="text-xs text-slate-500 font-medium">{todayReadable}</p>
            </div>
          </div>
        </div>

        {/* Live Status Pill */}
        <div className="self-start sm:self-auto">
          {attendanceState === 'NOT_STARTED' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>Not Started Yet</span>
            </span>
          )}

          {attendanceState === 'WORKING' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Working Now ⚡</span>
            </span>
          )}

          {attendanceState === 'COMPLETED' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Shift Completed</span>
            </span>
          )}
        </div>
      </div>

      {/* 2-Step Visual: 1. Start Work → 2. Finish Work */}
      <div className="bg-slate-50 rounded-2xl p-3 sm:p-3.5 border border-slate-200 mb-6 select-none">
        <div className="flex items-center justify-between gap-2">
          {/* Step 1: Start Work */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 transition-colors ${
                attendanceState === 'NOT_STARTED'
                  ? 'bg-green-600 text-white shadow-xs'
                  : 'bg-green-100 text-green-800 border border-green-300'
              }`}
            >
              {attendanceState === 'NOT_STARTED' ? '1' : <Check className="w-4 h-4 stroke-[3]" />}
            </div>
            <span
              className={`text-sm sm:text-base font-bold truncate ${
                attendanceState === 'NOT_STARTED' ? 'text-green-700' : 'text-slate-700'
              }`}
            >
              1. Start Work
            </span>
          </div>

          {/* Stepper Arrow */}
          <div className="px-2 text-slate-400 shrink-0 font-bold text-sm sm:text-base">
            →
          </div>

          {/* Step 2: Finish Work */}
          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end sm:justify-start">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 transition-colors ${
                attendanceState === 'COMPLETED'
                  ? 'bg-green-600 text-white shadow-xs'
                  : attendanceState === 'WORKING'
                  ? 'bg-orange-500 text-white shadow-xs animate-bounce'
                  : 'bg-slate-200 text-slate-500'
              }`}
            >
              {attendanceState === 'COMPLETED' ? <Check className="w-4 h-4 stroke-[3]" /> : '2'}
            </div>
            <span
              className={`text-sm sm:text-base font-bold truncate ${
                attendanceState === 'WORKING'
                  ? 'text-orange-600'
                  : attendanceState === 'COMPLETED'
                  ? 'text-slate-700'
                  : 'text-slate-400'
              }`}
            >
              2. Finish Work
            </span>
          </div>
        </div>
      </div>

      {/* Location Finding Loading State */}
      {isLocating && (
        <div className="p-6 sm:p-8 bg-amber-50 border-2 border-dashed border-amber-300 rounded-3xl flex flex-col items-center justify-center text-center space-y-3 animate-in fade-in zoom-in-95">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 animate-ping absolute inset-0" />
            <div className="w-16 h-16 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/30 relative z-10">
              <MapPin className="w-8 h-8 animate-bounce" />
            </div>
          </div>
          <div>
            <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Finding your location…
            </h3>
          </div>
        </div>
      )}

      {/* Location Error State with "Try again" Option */}
      {!isLocating && locationError && (
        <div className="p-5 sm:p-6 bg-rose-50 border-2 border-rose-200 rounded-3xl space-y-3 animate-in fade-in">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-rose-100 text-rose-600 rounded-2xl shrink-0 mt-0.5">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-rose-900">{locationError}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              onClick={() => {
                if (pendingAction === 'IN') handleStartWork(false);
                else if (pendingAction === 'OUT') handleFinishWork(false);
              }}
              className="w-full sm:w-auto px-6 py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Try again</span>
            </button>

            <button
              onClick={() => {
                if (pendingAction === 'IN') handleStartWork(true);
                else if (pendingAction === 'OUT') handleFinishWork(true);
              }}
              className="w-full sm:w-auto px-5 py-3.5 bg-white text-slate-700 hover:bg-slate-100 font-bold text-sm rounded-xl border border-slate-200 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <MapPin className="w-4 h-4 text-amber-600" />
              <span>Use site location</span>
            </button>
          </div>
        </div>
      )}

      {/* ONE LARGE ACTION AT A TIME (Only shown when not loading location or handling error) */}
      {!isLocating && !locationError && (
        <>
          {/* STATE 1: Before Work (One Big Green Button "Start Work" ▶) */}
          {attendanceState === 'NOT_STARTED' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => handleStartWork(false)}
                className="w-full min-h-[76px] sm:min-h-[84px] bg-green-600 hover:bg-green-500 active:scale-[0.98] text-white font-black text-2xl sm:text-3xl rounded-2xl shadow-xl shadow-green-600/30 flex items-center justify-center gap-3 transition-all cursor-pointer border-2 border-green-500"
              >
                <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-current translate-x-0.5" />
                <span>Start Work</span>
              </button>
            </div>
          )}

          {/* STATE 2: After Punching In (Show "Started at 9:00 AM" and One Big Orange Button "Finish Work" ■) */}
          {attendanceState === 'WORKING' && todayRecord && (
            <div className="space-y-4">
              <div className="p-4 bg-orange-50/80 border-2 border-orange-200 rounded-2xl text-center">
                <span className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  Started at <span className="text-orange-600 font-mono">{todayRecord.checkInTime}</span>
                </span>
              </div>

              {/* Big Orange "Finish Work" Button with ■ Icon */}
              <button
                type="button"
                onClick={() => handleFinishWork(false)}
                className="w-full min-h-[76px] sm:min-h-[84px] bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white font-black text-2xl sm:text-3xl rounded-2xl shadow-xl shadow-orange-500/30 flex items-center justify-center gap-3 transition-all cursor-pointer border-2 border-orange-400"
              >
                <Square className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
                <span>Finish Work</span>
              </button>
            </div>
          )}

          {/* STATE 3: After Punching Out (Success message: "All done! You worked 8h 15m 🎉") */}
          {attendanceState === 'COMPLETED' && todayRecord && (
            <div className="space-y-4">
              <div className="p-6 sm:p-8 bg-emerald-50 border-2 border-emerald-300 rounded-3xl text-center space-y-3">
                <div className="w-14 h-14 bg-emerald-600 text-white rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-emerald-600/25">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <h3 className="text-2xl sm:text-3xl font-black text-emerald-950 tracking-tight">
                  All done! You worked {finalDurationText} 🎉
                </h3>

                <div className="text-xs sm:text-sm font-semibold text-emerald-800">
                  Started {todayRecord.checkInTime} • Finished {todayRecord.checkOutTime}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
