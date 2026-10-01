import React, { useState, useMemo, useEffect } from 'react';
import { BillOfMaterials } from '../../types/solar';
import { storageService } from '../../services/storage';
import { useApp } from '../../context/AppContext';
import {
  X,
  Printer,
  Download,
  Copy,
  CheckCircle2,
  Truck,
  FileText,
  Building2,
  Calendar,
  MapPin,
  QrCode,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  Edit3
} from 'lucide-react';

interface EWayBillModalProps {
  isOpen: boolean;
  onClose: () => void;
  bom: BillOfMaterials | null;
  onSaved?: (ewbNumber: string) => void;
}

export const EWayBillModal: React.FC<EWayBillModalProps> = ({
  isOpen,
  onClose,
  bom,
  onSaved
}) => {
  const { showToast, triggerRefresh } = useApp();

  // Mode: 'preview' (Official GST EWB-01 layout) or 'edit' (Transport parameters)
  const [activeTab, setActiveTab] = useState<'preview' | 'edit'>('preview');
  const [copied, setCopied] = useState(false);

  // Retrieve contextual ERP records
  const settings = useMemo(() => storageService.getSettings(), [isOpen]);
  const customers = useMemo(() => storageService.getCustomers(), [isOpen]);
  const projects = useMemo(() => storageService.getProjects(), [isOpen]);
  const products = useMemo(() => storageService.getProducts(), [isOpen]);
  const invoices = useMemo(() => storageService.getSalesInvoices(), [isOpen]);

  // Match records for active BOM
  const linkedProject = useMemo(() => {
    if (!bom) return null;
    return (
      projects.find(
        p => p.id === bom.projectId || p.projectCode === bom.projectCode || p.title === bom.projectTitle
      ) || null
    );
  }, [bom, projects]);

  const linkedCustomer = useMemo(() => {
    if (!bom) return null;
    return (
      customers.find(
        c =>
          (linkedProject && c.id === linkedProject.customerId) ||
          c.name.toLowerCase() === bom.customerName.toLowerCase() ||
          (c.companyName && c.companyName.toLowerCase() === bom.customerName.toLowerCase())
      ) || null
    );
  }, [bom, linkedProject, customers]);

  const linkedInvoice = useMemo(() => {
    if (!bom) return null;
    return (
      invoices.find(
        inv =>
          (bom.projectId && inv.projectId === bom.projectId) ||
          inv.customerName.toLowerCase() === bom.customerName.toLowerCase()
      ) || null
    );
  }, [bom, invoices]);

  // Form State for E-Way Bill Parameters
  const [ewbNumber, setEwbNumber] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [docDate, setDocDate] = useState('');
  const [supplyType, setSupplyType] = useState('Outward - Supply');
  const [subType, setSubType] = useState('Supply to Solar EPC Site');
  const [transporterName, setTransporterName] = useState('Gujarat Solar Logistics Express Ltd.');
  const [transporterId, setTransporterId] = useState('24AAACG1923K1ZT');
  const [vehicleNumber, setVehicleNumber] = useState('GJ-01-BX-8492');
  const [transportDocNo, setTransportDocNo] = useState('');
  const [transportMode, setTransportMode] = useState<'Road' | 'Rail' | 'Air' | 'Ship'>('Road');
  const [vehicleType, setVehicleType] = useState<'Regular' | 'ODC (Over Dimensional Cargo)'>('Regular');
  const [distanceKm, setDistanceKm] = useState('48');

  // Initialize or reset EWB details when BOM changes
  useEffect(() => {
    if (!bom) return;

    const existingNum = bom.ewayBillNumber;
    const generatedNum =
      existingNum ||
      `2410 ${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(1000 + Math.random() * 9000)}`;

    setEwbNumber(generatedNum);
    setDocNumber(linkedInvoice?.invoiceNumber || `DC-${bom.bomNumber}`);
    setDocDate(linkedInvoice?.invoiceDate || new Date().toISOString().split('T')[0]);
    setTransportDocNo(`LR-EWB-${bom.bomNumber.replace(/[^0-9]/g, '').slice(-4) || '9241'}`);
    setActiveTab('preview');
  }, [bom, linkedInvoice]);

  if (!isOpen || !bom) return null;

  // Calculate tax breakdowns and line items with HSN codes
  const enrichedItems = bom.items.map(it => {
    const prod = products.find(p => p.id === it.productId || p.sku === it.sku || p.name === it.productName);

    let hsn = prod?.hsnCode || '';
    if (!hsn) {
      if (it.category === 'Solar Panels') hsn = '8541 43 00';
      else if (it.category === 'Inverters') hsn = '8504 40 90';
      else if (it.category === 'Mounting Structures') hsn = '7308 90 90';
      else if (it.category === 'Electrical & Cables') hsn = '8544 60 90';
      else hsn = '8541 40 11';
    }

    const taxableValue = it.totalCost;
    const cgstRate = 9;
    const sgstRate = 9;
    const cgstAmount = (taxableValue * cgstRate) / 100;
    const sgstAmount = (taxableValue * sgstRate) / 100;
    const lineTotal = taxableValue + cgstAmount + sgstAmount;

    return {
      ...it,
      hsnCode: hsn,
      taxableValue,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      lineTotal
    };
  });

  const totalTaxable = enrichedItems.reduce((acc, i) => acc + i.taxableValue, 0);
  const totalCGST = enrichedItems.reduce((acc, i) => acc + i.cgstAmount, 0);
  const totalSGST = enrichedItems.reduce((acc, i) => acc + i.sgstAmount, 0);
  const grandTotal = totalTaxable + totalCGST + totalSGST;

  // Validity calculation: 1 day for first 200 km
  const generatedDateTime = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  const validUntilDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const handleCopyEwb = () => {
    navigator.clipboard.writeText(ewbNumber.replace(/\s+/g, ''));
    setCopied(true);
    showToast('E-Way Bill Number copied to clipboard', 'info');
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSaveEWayBill = () => {
    try {
      const updatedBOM: BillOfMaterials = {
        ...bom,
        ewayBillNumber: ewbNumber,
        ewayBillDate: new Date().toISOString()
      };
      storageService.saveBOM(updatedBOM);
      triggerRefresh();
      showToast(`E-Way Bill ${ewbNumber} generated and attached to ${bom.bomNumber}`, 'success');
      if (onSaved) onSaved(ewbNumber);
    } catch (e: any) {
      showToast(e?.message || 'Failed to save E-Way Bill', 'error');
    }
  };

  const handleDownloadJSON = () => {
    const payload = {
      version: '1.0.0924',
      billLists: [
        {
          userGstin: settings.companyGst || '24AAECS9921D1Z8',
          supplyType: 'O',
          subSupplyType: '1',
          docType: 'INV',
          docNo: docNumber,
          docDate: docDate.split('-').reverse().join('/'),
          fromGstin: settings.companyGst || '24AAECS9921D1Z8',
          fromTrdName: settings.companyName,
          fromAddr1: settings.companyAddress,
          fromPlace: 'Ahmedabad',
          fromPincode: 380054,
          fromStateCode: 24,
          toGstin: linkedCustomer?.gstNumber || 'URP',
          toTrdName: linkedCustomer?.companyName || bom.customerName,
          toAddr1: linkedProject?.siteAddress || linkedCustomer?.siteAddress || 'Project Site',
          toPlace: linkedProject?.city || linkedCustomer?.city || 'Ahmedabad',
          toPincode: Number(linkedCustomer?.pincode) || 380015,
          toStateCode: 24,
          totalValue: totalTaxable,
          cgstValue: totalCGST,
          sgstValue: totalSGST,
          igstValue: 0,
          totInvValue: grandTotal,
          transporterId,
          transporterName,
          transDocNo: transportDocNo,
          transMode: transportMode === 'Road' ? '1' : '2',
          transDistance: distanceKm,
          vehicleNo: vehicleNumber.replace(/[^A-Za-z0-9]/g, ''),
          vehicleType: vehicleType.startsWith('Regular') ? 'R' : 'O',
          itemList: enrichedItems.map((item, idx) => ({
            itemNo: idx + 1,
            productName: item.productName,
            productDesc: item.sku,
            hsnCode: item.hsnCode.replace(/\s+/g, ''),
            quantity: item.requiredQty,
            qtyUnit: item.unit,
            taxableAmount: item.taxableValue,
            cgstRate: item.cgstRate,
            sgstRate: item.sgstRate,
            igstRate: 0
          }))
        }
      ]
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `EWB_${bom.bomNumber}_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('GST Portal E-Way Bill JSON downloaded', 'info');
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[95vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 my-auto">
        {/* Top Header Bar */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600 text-white shadow-xs">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  Electronic Way Bill (E-Way Bill)
                </h3>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Form GST EWB-01
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Generated from Solar EPC Bill of Materials • {bom.bomNumber} ({bom.customerName})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Switcher Tabs */}
            <div className="flex items-center bg-slate-200/80 p-0.5 rounded-lg text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`px-3 py-1 rounded-md transition-all ${
                  activeTab === 'preview'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                EWB-01 Document
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className={`px-3 py-1 rounded-md transition-all flex items-center gap-1 ${
                  activeTab === 'edit'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Edit3 className="w-3 h-3" />
                Transport Details
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === 'edit' ? (
            /* Transport Configuration Tab */
            <div className="space-y-5 animate-in fade-in">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">E-Way Bill Transport Parameters</span>: Verify and update transporter
                  details, vehicle registration, and approximate transport distance. These details populate Part-B of
                  the GST EWB-01 certificate.
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Document / Invoice Number
                  </label>
                  <input
                    type="text"
                    value={docNumber}
                    onChange={e => setDocNumber(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Document Date
                  </label>
                  <input
                    type="date"
                    value={docDate}
                    onChange={e => setDocDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Vehicle Number (Part-B)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. GJ-01-BX-8492"
                    value={vehicleNumber}
                    onChange={e => setVehicleNumber(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 text-xs font-mono font-bold bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-indigo-500/20 uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Vehicle Type
                  </label>
                  <select
                    value={vehicleType}
                    onChange={e => setVehicleType(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="Regular">Regular (Standard Solar Truck/LCV)</option>
                    <option value="ODC (Over Dimensional Cargo)">ODC (Over Dimensional Cargo)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Transporter Name
                  </label>
                  <input
                    type="text"
                    value={transporterName}
                    onChange={e => setTransporterName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Transporter ID / GSTIN
                  </label>
                  <input
                    type="text"
                    value={transporterId}
                    onChange={e => setTransporterId(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-indigo-500/20 uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Transporter Doc / LR Number
                  </label>
                  <input
                    type="text"
                    value={transportDocNo}
                    onChange={e => setTransportDocNo(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Approximate Transit Distance (km)
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={distanceKm}
                      onChange={e => setDistanceKm(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">km</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('preview');
                    showToast('Transport parameters applied to E-Way Bill', 'info');
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors"
                >
                  Apply & Preview E-Way Bill
                </button>
              </div>
            </div>
          ) : (
            /* Official Form GST EWB-01 Printable View */
            <div id="print-eway-bill-area" className="space-y-4 print:p-0">
              {/* Document Certificate Frame */}
              <div className="border-2 border-slate-800 rounded-xl overflow-hidden bg-white text-slate-900 font-sans shadow-xs">
                {/* Government Header Banner */}
                <div className="bg-slate-900 text-white p-4 border-b-2 border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-black text-sm">
                      EWB
                    </div>
                    <div>
                      <h4 className="font-extrabold text-sm sm:text-base tracking-wide uppercase">
                        GOVERNMENT OF INDIA • GOODS AND SERVICES TAX
                      </h4>
                      <p className="text-[11px] text-amber-400 font-semibold tracking-wider uppercase">
                        E-WAY BILL SYSTEM • FORM GST EWB-01 (Rule 138)
                      </p>
                    </div>
                  </div>

                  <div className="text-right hidden sm:block">
                    <span className="text-[10px] text-slate-400 block font-mono">PORTAL VERIFIED</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">ewaybillgst.gov.in</span>
                  </div>
                </div>

                {/* Key Metadata Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-200 border-b border-slate-200 bg-slate-50/70 text-xs">
                  <div className="p-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">E-Way Bill No:</span>
                    <span className="font-mono font-black text-indigo-700 text-sm">{ewbNumber}</span>
                  </div>
                  <div className="p-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">EWB Generated Date:</span>
                    <span className="font-semibold text-slate-800">{generatedDateTime}</span>
                  </div>
                  <div className="p-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Valid From:</span>
                    <span className="font-semibold text-slate-800">{generatedDateTime}</span>
                  </div>
                  <div className="p-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">Valid Until:</span>
                    <span className="font-bold text-emerald-700">{validUntilDate}</span>
                  </div>
                </div>

                {/* Verification Barcode & QR Code Strip */}
                <div className="p-3.5 bg-slate-50/50 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-white border border-slate-300 rounded-lg shadow-2xs">
                      <QrCode className="w-12 h-12 text-slate-900" />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block">
                        Official Verification QR / Barcode
                      </span>
                      <span className="text-xs font-mono text-slate-700">
                        {settings.companyGst || '24AAECS9921D1Z8'} / {ewbNumber.replace(/\s+/g, '')} /{' '}
                        {docNumber}
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Scannable by State & Central GST Mobile Enforcement Squads
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyEwb}
                      className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded-md text-[11px] font-semibold text-slate-700 flex items-center gap-1 shadow-2xs transition-colors cursor-pointer"
                    >
                      {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Copied!' : 'Copy EWB'}</span>
                    </button>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded">
                      ACTIVE & VALID
                    </span>
                  </div>
                </div>

                {/* PART-A: Transaction, Consignor & Consignee Details */}
                <div className="p-4 space-y-4">
                  <div className="flex items-center gap-2 pb-1 border-b border-slate-200 text-xs font-bold text-slate-800 uppercase tracking-wide">
                    <span className="w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center text-[10px]">
                      A
                    </span>
                    <span>PART-A: Supply, Consignor (From) & Consignee (To) Details</span>
                  </div>

                  {/* Document & Transaction Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-lg text-xs border border-slate-100">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Transaction Type</span>
                      <span className="font-semibold text-slate-800">{supplyType}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Sub-Type</span>
                      <span className="font-semibold text-slate-800">{subType}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Doc Type & Number</span>
                      <span className="font-bold text-slate-900 font-mono">{docNumber}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Document Date</span>
                      <span className="font-semibold text-slate-800">{docDate}</span>
                    </div>
                  </div>

                  {/* Consignor (From) and Consignee (To) Side-by-Side */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {/* Consignor: From */}
                    <div className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-xl space-y-1.5">
                      <span className="text-[10px] font-extrabold uppercase text-indigo-700 tracking-wider block">
                        FROM (CONSIGNOR / SUPPLIER)
                      </span>
                      <div className="font-bold text-slate-900 text-sm">
                        {settings.companyName || 'SolarPulse EPC & Energy Solutions'}
                      </div>
                      <div className="text-slate-600 font-mono text-xs">
                        GSTIN: <strong>{settings.companyGst || '24AAECS9921D1Z8'}</strong>
                      </div>
                      <div className="text-slate-600 text-xs flex items-start gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span>{settings.companyAddress}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                        Dispatch From: <strong>Ahmedabad, Gujarat (24)</strong>
                      </div>
                    </div>

                    {/* Consignee: To (Customer & Project Site) */}
                    <div className="p-3.5 bg-slate-50/70 border border-slate-200 rounded-xl space-y-1.5">
                      <span className="text-[10px] font-extrabold uppercase text-amber-700 tracking-wider block">
                        TO (CONSIGNEE / RECIPIENT & SITE)
                      </span>
                      <div className="font-bold text-slate-900 text-sm">
                        {linkedCustomer?.companyName || bom.customerName}
                      </div>
                      <div className="text-slate-600 font-mono text-xs">
                        GSTIN: <strong>{linkedCustomer?.gstNumber || 'URP (Unregistered Solar Consumer)'}</strong>
                      </div>
                      <div className="text-slate-600 text-xs flex items-start gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span>
                          {linkedProject?.siteAddress ||
                            linkedCustomer?.siteAddress ||
                            `${bom.customerName} Solar Installation Site`}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                        Delivery Site: <strong>{linkedCustomer?.city || linkedProject?.city || 'Gujarat'}</strong> ({linkedCustomer?.state || 'Gujarat'} - {linkedCustomer?.pincode || '380015'})
                      </div>
                    </div>
                  </div>

                  {/* Materials & Goods Table */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-700 uppercase">
                        Goods & Materials Dispatched (from BOM {bom.bomNumber})
                      </span>
                      <span className="text-[11px] text-slate-500 font-medium">
                        Total {enrichedItems.length} solar equipment items
                      </span>
                    </div>

                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                          <tr>
                            <th className="p-2">#</th>
                            <th className="p-2">Item Description</th>
                            <th className="p-2 text-center font-mono">HSN Code</th>
                            <th className="p-2 text-center">Qty</th>
                            <th className="p-2 text-right">Taxable Val (₹)</th>
                            <th className="p-2 text-right">GST (18%)</th>
                            <th className="p-2 text-right">Total (₹)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {enrichedItems.map((item, idx) => (
                            <tr key={item.id} className="hover:bg-slate-50/60">
                              <td className="p-2 text-slate-400">{idx + 1}</td>
                              <td className="p-2">
                                <span className="font-semibold text-slate-800">{item.productName}</span>
                                <span className="text-[10px] text-slate-400 block font-mono">{item.sku}</span>
                              </td>
                              <td className="p-2 text-center font-mono font-medium text-slate-600">
                                {item.hsnCode}
                              </td>
                              <td className="p-2 text-center font-bold text-slate-700">
                                {item.requiredQty} {item.unit}
                              </td>
                              <td className="p-2 text-right font-mono text-slate-700">
                                ₹{item.taxableValue.toLocaleString('en-IN')}
                              </td>
                              <td className="p-2 text-right font-mono text-slate-600">
                                ₹{(item.cgstAmount + item.sgstAmount).toLocaleString('en-IN')}
                              </td>
                              <td className="p-2 text-right font-mono font-bold text-slate-900">
                                ₹{item.lineTotal.toLocaleString('en-IN')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                          <tr>
                            <td colSpan={4} className="p-2.5 text-right text-slate-700 uppercase text-xs">
                              Consignment Total (Taxable + CGST + SGST):
                            </td>
                            <td className="p-2.5 text-right font-mono text-slate-800">
                              ₹{totalTaxable.toLocaleString('en-IN')}
                            </td>
                            <td className="p-2.5 text-right font-mono text-slate-700">
                              ₹{(totalCGST + totalSGST).toLocaleString('en-IN')}
                            </td>
                            <td className="p-2.5 text-right font-mono text-indigo-700 text-sm">
                              ₹{grandTotal.toLocaleString('en-IN')}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </div>

                {/* PART-B: Vehicle & Transporter Details */}
                <div className="p-4 bg-slate-50/50 border-t border-slate-200 space-y-3">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-200 text-xs font-bold text-slate-800 uppercase tracking-wide">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center text-[10px]">
                        B
                      </span>
                      <span>PART-B: Vehicle & Transporter Details</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveTab('edit')}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1 cursor-pointer print:hidden"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Edit Vehicle/Transporter</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-white p-3 rounded-lg border border-slate-200">
                    <div>
                      <span className="text-slate-400 block text-[10px]">Mode of Transport</span>
                      <span className="font-bold text-slate-800">{transportMode}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Vehicle Registration No.</span>
                      <span className="font-mono font-black text-indigo-700 uppercase">{vehicleNumber}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Vehicle Type</span>
                      <span className="font-semibold text-slate-800">{vehicleType}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Approx. Transit Distance</span>
                      <span className="font-bold text-slate-800">{distanceKm} km</span>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-slate-400 block text-[10px]">Transporter Name</span>
                      <span className="font-semibold text-slate-800">{transporterName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Transporter GSTIN / ID</span>
                      <span className="font-mono font-semibold text-slate-700">{transporterId}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">Transporter Doc / LR No.</span>
                      <span className="font-mono font-bold text-slate-800">{transportDocNo}</span>
                    </div>
                  </div>

                  {/* Statutory Legal Disclaimer */}
                  <div className="pt-2 text-[10px] text-slate-500 leading-relaxed border-t border-slate-200">
                    <strong>Statutory Declaration:</strong> This is a digitally verified Electronic Way Bill generated under
                    Rule 138 of the Central Goods and Services Tax Rules, 2017. The consignor certifies that the particulars
                    furnished above are true and correct, and the materials correspond to Solar EPC execution for{' '}
                    <strong>{bom.customerName}</strong>. Valid across state & national highways.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">
              BOM Total Value: <strong className="text-slate-900 font-mono">₹{grandTotal.toLocaleString('en-IN')}</strong> (Inc. GST)
            </span>
            {bom.ewayBillNumber && (
              <span className="text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded font-semibold">
                Saved in ERP
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadJSON}
              title="Download standard JSON for GST E-Way Bill portal upload"
              className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>GST Portal JSON</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              title="Print official Form GST EWB-01 certificate"
              className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              <span>Print E-Way Bill</span>
            </button>

            <button
              type="button"
              onClick={handleSaveEWayBill}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Save & Confirm EWB</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
