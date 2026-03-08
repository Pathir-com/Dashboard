import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowRight, Phone, Globe, TrendingUp } from 'lucide-react';

export default function Calculator() {
  const [missedCallsPerDay, setMissedCallsPerDay] = useState(8);
  const [websiteVisitorsPerDay, setWebsiteVisitorsPerDay] = useState(60);
  const [websiteDropOffPercentage, setWebsiteDropOffPercentage] = useState(40);
  const [conversionPercentage, setConversionPercentage] = useState(15);
  const [patientLTV, setPatientLTV] = useState(2500);

  // Calculations
  const lostWebsiteEnquiriesPerDay = websiteVisitorsPerDay * (websiteDropOffPercentage / 100);
  const totalLostEnquiriesPerDay = missedCallsPerDay + lostWebsiteEnquiriesPerDay;
  const lostPatientsPerDay = totalLostEnquiriesPerDay * (conversionPercentage / 100);
  const monthlyRevenueLost = Math.round(lostPatientsPerDay * patientLTV * 30);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0E0E11' }}>
      {/* Logo */}
      <div className="absolute top-6 left-6">
        <img 
          src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/69598d89634866d811371736/596c9f930_squareblackbackground.png" 
          alt="Pathir"
          className="h-10 w-10 rounded-lg shadow-sm"
        />
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 pt-20 sm:pt-12">
        {/* Header */}
        <div className="mb-8 sm:mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold mb-3" style={{ color: '#F2F2F5' }}>
            Missed Patient Revenue Calculator
          </h1>
          <p className="text-base sm:text-lg max-w-2xl" style={{ color: '#A8A8B3' }}>
            Estimate how much revenue your practice may be losing from missed calls and unanswered website enquiries.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 sm:gap-8">
          {/* Input Section */}
          <div className="space-y-4 sm:space-y-6">
            {/* Section A: Missed Calls */}
            <Card style={{ 
              backgroundColor: 'rgba(22, 22, 28, 0.6)', 
              borderColor: 'rgba(42, 42, 52, 0.5)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)'
            }}>
              <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: '#F2F2F5' }}>
                    <Phone className="w-5 h-5" style={{ color: '#814AC8' }} />
                    Missed Calls
                  </h3>

                  <div className="space-y-5">
                    {/* Missed calls per day */}
                    <div>
                      <Label className="text-sm font-medium" style={{ color: '#7A7A85' }}>
                        Missed calls per day
                      </Label>
                      <Input
                        type="number"
                        value={missedCallsPerDay}
                        onChange={(e) => setMissedCallsPerDay(Number(e.target.value) || 0)}
                        className="mt-1.5 focus:ring-2"
                        style={{ 
                          backgroundColor: '#1E1E26', 
                          borderColor: '#2F2F3A',
                          color: '#F2F2F5'
                        }}
                        min="0"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Section for Website */}
            <Card style={{ 
              backgroundColor: 'rgba(22, 22, 28, 0.6)', 
              borderColor: 'rgba(42, 42, 52, 0.5)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)'
            }}>
              <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: '#F2F2F5' }}>
                    <Globe className="w-5 h-5" style={{ color: '#814AC8' }} />
                    Missed Website Visitors
                  </h3>

                  <div className="space-y-5">
                    {/* Website visitors per day */}
                    <div>
                      <Label className="text-sm font-medium" style={{ color: '#7A7A85' }}>
                        Website visitors per day
                      </Label>
                      <Input
                        type="number"
                        value={websiteVisitorsPerDay}
                        onChange={(e) => setWebsiteVisitorsPerDay(Number(e.target.value) || 0)}
                        className="mt-1.5 focus:ring-2"
                        style={{ 
                          backgroundColor: '#1E1E26', 
                          borderColor: '#2F2F3A',
                          color: '#F2F2F5'
                        }}
                        min="0"
                      />
                    </div>

                    {/* Website drop-off percentage */}
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <Label className="text-sm font-medium" style={{ color: '#7A7A85' }}>
                          Percentage of visitors who leave without getting answers
                        </Label>
                        <span className="text-sm font-semibold" style={{ color: '#F2F2F5' }}>
                          {websiteDropOffPercentage}%
                        </span>
                      </div>
                      <Slider
                        value={[websiteDropOffPercentage]}
                        onValueChange={(value) => setWebsiteDropOffPercentage(value[0])}
                        min={0}
                        max={100}
                        step={1}
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Conversion & Value */}
            <Card style={{ 
              backgroundColor: 'rgba(22, 22, 28, 0.6)', 
              borderColor: 'rgba(42, 42, 52, 0.5)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)'
            }}>
              <CardContent className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: '#F2F2F5' }}>
                    <TrendingUp className="w-5 h-5" style={{ color: '#814AC8' }} />
                    Conversion & Value
                  </h3>

                  <div className="space-y-5">
                    {/* Conversion percentage */}
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <Label className="text-sm font-medium" style={{ color: '#7A7A85' }}>
                          Estimated % of lost enquiries that would have become patients
                        </Label>
                        <span className="text-sm font-semibold" style={{ color: '#F2F2F5' }}>
                          {conversionPercentage}%
                        </span>
                      </div>
                      <Slider
                        value={[conversionPercentage]}
                        onValueChange={(value) => setConversionPercentage(value[0])}
                        min={0}
                        max={100}
                        step={1}
                        className="mt-1.5"
                      />
                    </div>

                    {/* Patient LTV */}
                    <div>
                      <Label className="text-sm font-medium" style={{ color: '#7A7A85' }}>
                        Average private patient lifetime value (£)
                      </Label>
                      <Input
                        type="number"
                        value={patientLTV}
                        onChange={(e) => setPatientLTV(Number(e.target.value) || 0)}
                        className="mt-1.5 focus:ring-2"
                        style={{ 
                          backgroundColor: '#1E1E26', 
                          borderColor: '#2F2F3A',
                          color: '#F2F2F5'
                        }}
                        min="0"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Results Section */}
          <div className="space-y-4 sm:space-y-6">
            <Card className="border" style={{ 
              backgroundColor: 'rgba(22, 22, 28, 0.6)', 
              borderColor: '#F2F2F5', 
              borderWidth: '1px',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)'
            }}>
              <CardContent className="p-6 sm:p-8 text-center">
                <div className="mb-6">
                  <p className="text-sm font-medium uppercase tracking-wide mb-4" style={{ color: '#7A7A85' }}>
                    Estimated Revenue Lost Per Month
                  </p>
                  <div className="text-5xl sm:text-7xl font-bold mb-6 py-4" style={{ 
                    color: '#814AC8',
                    textShadow: '0 0 40px rgba(129, 74, 200, 0.3)',
                    letterSpacing: '-0.02em'
                  }}>
                    {formatCurrency(monthlyRevenueLost)}
                  </div>
                  <p className="text-sm max-w-sm mx-auto" style={{ color: '#A8A8B3' }}>
                    Based on missed calls and website visitors leaving without booking.
                  </p>
                </div>

                <div className="pt-6" style={{ borderTop: '1px solid #2A2A34' }}>
                  <p className="text-xs italic" style={{ color: '#7A7A85' }}>
                    Even if this estimate is 50% too high, that still represents a significant monthly loss.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* CTA Section */}
            <Card style={{ 
              backgroundColor: 'rgba(22, 22, 28, 0.6)', 
              borderColor: 'rgba(42, 42, 52, 0.5)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)'
            }}>
              <CardContent className="p-6 sm:p-8">
                <h3 className="text-xl sm:text-2xl font-bold mb-4" style={{ color: '#F2F2F5' }}>
                  Pathir captures this missed demand automatically.
                </h3>
                
                <ul className="space-y-3 mb-6">
                  <li className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: '#814AC8' }}>
                      <span style={{ color: '#FFFFFF' }} className="text-xs">✓</span>
                    </div>
                    <span style={{ color: '#A8A8B3' }}>
                      Answers calls instantly, 24/7
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: '#814AC8' }}>
                      <span style={{ color: '#FFFFFF' }} className="text-xs">✓</span>
                    </div>
                    <span style={{ color: '#A8A8B3' }}>
                      Responds to website questions in seconds
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: '#814AC8' }}>
                      <span style={{ color: '#FFFFFF' }} className="text-xs">✓</span>
                    </div>
                    <span style={{ color: '#A8A8B3' }}>
                      Books appointments without staff involvement
                    </span>
                  </li>
                </ul>

                <a href="https://pathir.com/see" target="_blank" rel="noopener noreferrer">
                  <Button 
                    className="w-full font-semibold py-6 text-lg transition-colors"
                    style={{ backgroundColor: '#814AC8', color: '#FFFFFF' }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#6E3FB0'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#814AC8'}
                    size="lg"
                  >
                    See how Pathir works
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}