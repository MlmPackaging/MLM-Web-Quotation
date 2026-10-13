// Client-side PDF generation for static deployment
// Uses jsPDF to create basic quotation PDFs

function generateClientSidePDF(quotation) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  try {
    // Colors
    const primaryColor = [44, 62, 80]; // #2c3e50
    const accentColor = [231, 76, 60]; // #e74c3c
    const textColor = [0, 0, 0];

    // Header
    doc.setFontSize(20);
    doc.setTextColor(...primaryColor);
    doc.text('MLM PACKAGING SDN BHD', 105, 30, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(...textColor);
    doc.text('PROFESSIONAL PACKAGING SOLUTIONS', 105, 40, { align: 'center' });

    // Quotation title
    doc.setFontSize(16);
    doc.setTextColor(...accentColor);
    doc.text(`QUOTATION - ${quotation.quotation_number}`, 105, 60, { align: 'center' });

    let yPos = 80;

    // Client Information
    doc.setFontSize(12);
    doc.setTextColor(...primaryColor);
    doc.text('CLIENT INFORMATION', 20, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setTextColor(...textColor);

    const clientInfo = [
      `Company: ${quotation.user_company || 'N/A'}`,
      `Contact Person: ${quotation.user_contact_person || 'N/A'}`,
      `Phone: ${quotation.user_phone || 'N/A'}`,
      `Email: ${quotation.user_email || 'N/A'}`,
      `Address: ${quotation.user_address || 'N/A'}`
    ];

    clientInfo.forEach(line => {
      doc.text(line, 20, yPos);
      yPos += 8;
    });

    yPos += 10;

    // Quotation Details
    doc.setFontSize(12);
    doc.setTextColor(...primaryColor);
    doc.text('QUOTATION DETAILS', 20, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setTextColor(...textColor);

    // Extract data from quotation_data
    let quotationData = {};
    try {
      quotationData = typeof quotation.quotation_data === 'string'
        ? JSON.parse(quotation.quotation_data)
        : quotation.quotation_data || {};
    } catch (e) {
      quotationData = {};
    }

    const input = quotationData.input || {};
    const dimensions = input.dimensions || {};
    const finishing = input.finishing || {};

    const details = [
      `Dimensions: ${dimensions.width || 'N/A'}mm x ${dimensions.height || 'N/A'}mm x ${dimensions.gusset || 'N/A'}mm`,
      `Paper Type: ${input.paper || 'N/A'}`,
      `Printing: ${input.printing || 'N/A'}`,
      `Quantity: ${input.quantity ? Number(input.quantity).toLocaleString() : 'N/A'} pcs`,
      `Varnish: ${finishing.varnish || 'None'}`,
      `Lamination: ${finishing.lamination || 'None'}`,
      `Status: ${quotation.status || 'N/A'}`
    ];

    details.forEach(line => {
      doc.text(line, 20, yPos);
      yPos += 8;
    });

    yPos += 10;

    // Pricing
    doc.setFontSize(12);
    doc.setTextColor(...primaryColor);
    doc.text('PRICING SUMMARY', 20, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setTextColor(...textColor);

    const totalAmount = quotation.total_amount || 0;
    const pricing = [
      `Total Amount: RM ${Number(totalAmount).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`
    ];

    pricing.forEach(line => {
      doc.text(line, 20, yPos);
      yPos += 8;
    });

    // Footer
    const pageHeight = doc.internal.pageSize.height;
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text('This quotation is valid for 30 days from the date of issue.', 105, pageHeight - 30, { align: 'center' });
    doc.text('Generated on ' + new Date().toLocaleDateString(), 105, pageHeight - 20, { align: 'center' });

    return doc;
  } catch (error) {
    console.error('PDF generation error:', error);
    throw new Error('Failed to generate PDF: ' + error.message);
  }
}

function downloadClientSidePDF(quotation) {
  try {
    const doc = generateClientSidePDF(quotation);
    doc.save(`quotation-${quotation.quotation_number}.pdf`);
  } catch (error) {
    alert('Failed to generate PDF: ' + error.message);
  }
}